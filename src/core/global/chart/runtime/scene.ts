/* eslint-disable max-lines -- scene compilation and per-line sampling are one cohesive runtime. */
/**
 * The chart scene runtime: compiles a chart into per-line and per-note state.
 *
 * `SceneRuntime` evaluates event tracks and control curves at a chart time and
 * hands back sampled line and note state; canvas, WebGL and layout stay in the
 * renderer that consumes it.
 */
import { EventTrack, SpeedIntegral } from "../timing/events.ts";
import { IntervalIndex } from "../../../utils/intervalIndex.ts";
import { LineFloorCursor } from "./lineFloorCursor.ts";
import {
  buildControlDistanceEnvelope,
  NoteVisibilityDirectory,
  type ControlDistanceEnvelope,
  type NoteVisibilityEntry,
  type VisibilityDirectoryQueryStats,
} from "./noteVisibility.ts";
import { lowerBound } from "../../../utils/search.ts";
import { easing } from "../../../utils/easing.ts";
import {
  channelInteger,
  colorChannels,
  inheritsParentRotation,
  lineParentIndex,
  noteIsAbove,
} from "../chart.ts";
import { CONTROL_TRACKS, type ControlTrackProperty } from "../chartTracks.ts";
import { trajectoryHasRotation } from "../trajectory/curveTrajectory.ts";
import { beatValue, isOrderedBeatRange } from "../timing/beat.ts";
import { isPlaceholderLine } from "../streaming/chartDocument.ts";
import type { JudgeLine, JudgeLineEvent, LineEventValue } from "../chart.ts";
import type { ControlPoint } from "../chart.ts";
import type { Chart } from "../chart.ts";
import type { TempoSource } from "../timing/events.ts";

/** A point of a line control curve, tagged with the property it interpolates. */
export type ControlCurvePoint = ControlPoint;

export type ControlProperty = ControlTrackProperty;

/** Built-in colour used when a renderer does not supply a user preference. */
export const DEFAULT_LINE_COLOR = [237, 236, 176] as const;

/** Fill missing channels from `DEFAULT_LINE_COLOR` and keep finite values. */
function normalizedColor(color: readonly number[]): number[] {
  const normalized = DEFAULT_LINE_COLOR.map((fallback, index) => {
    const channel = Number(color[index]);
    return Number.isFinite(channel) ? channel : fallback;
  });
  const alpha = Number(color[3]);
  if (Number.isFinite(alpha)) {
    normalized.push(Math.max(0, Math.min(1, alpha)));
  }
  return normalized;
}

/** True when both colour arrays have equal channels. */
function colorsEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((channel, index) => channel === right[index]);
}

/** A line control curve sampled by floor distance. */
export class ControlCurve {
  declare property: ControlProperty;
  declare points: ControlCurvePoint[];

  /** Sort control points by distance so evaluation always runs low to high. */
  constructor(points: ControlCurvePoint[] | undefined, property: ControlProperty) {
    this.property = property;
    // RPE charts are serialized in either direction depending on the exporter.
    // Evaluation is always from the smaller distance to the larger one.
    this.points = [...(points ?? [])].sort((left, right) => (left.x ?? 0) - (right.x ?? 0));
  }
  /** Interpolate the controlled property at `distance`, clamped to the endpoint values. */
  value(distance: number): number {
    const points = this.points,
      key = this.property;
    if (points.length <= 1) {
      return points.length ? (points[0][key] as number) : 1;
    }
    const amplitude = (point: ControlCurvePoint | undefined): number => point?.[key] as number;
    const position = (point: ControlCurvePoint): number => point.x ?? 0;
    if (points.length === 2 && points[0][key] === points[1][key]) {
      return amplitude(points[0]);
    }
    const low = lowerBound(points, distance, position);
    if (!low) {
      return amplitude(points[0]);
    }
    if (low === points.length) {
      return amplitude(points[points.length - 1]);
    }
    const start = points[low - 1];
    const end = points[low];
    const span = position(end) - position(start);
    return (
      amplitude(start) +
      (amplitude(end) - amplitude(start)) *
        (span ? easing((distance - position(start)) / span, end.easing ?? 1) : 1)
    );
  }
}

/** A note plus its resolved seconds and floor positions. */
export interface NoteEntry extends NoteVisibilityEntry {}

export interface LineState {
  x: number;
  y: number;
  rotation: number;
  alpha: number;
  scaleX: number;
  scaleY: number;
  color: number[];
  text: string;
  incline: LineEventValue;
  floor: number;
}

export interface NoteState {
  x: number;
  y: number;
  tail: number;
  size: number;
  alpha: number;
  skew: number;
  showHead: boolean;
}

/** Per-line visibility work measured for the most recent query. */
export interface VisibilityQueryStats extends VisibilityDirectoryQueryStats {
  candidateCount: number;
  visibleCount: number;
  indexMs: number;
}

export type SampledLineState = LineState;

/** Create a zeroed visibility sample before the first line query. */
function emptyVisibilityStats(): VisibilityQueryStats {
  return {
    candidateCount: 0,
    visibleCount: 0,
    spatialCandidateCount: 0,
    temporalCandidateCount: 0,
    holdCandidateCount: 0,
    indexMs: 0,
  };
}

/** A certified direction of the accumulated line floor. */
type FloorDirection = -1 | 0 | 1;

/** Return whether an easing can stay between its endpoints on the unit interval. */
function isRangePreservingSpeedEasing(type: number, left: number, right: number): boolean {
  return (
    Number.isInteger(type) &&
    (type === 0 || (type >= 1 && type <= 19) || type === 22) &&
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    left >= 0 &&
    left <= 1 &&
    right >= 0 &&
    right <= 1
  );
}

/** Prove that one speed layer never changes the sign of its integrated slope. */
function speedDirection(speed: SpeedIntegral): FloorDirection | null {
  let direction: FloorDirection = 0;
  for (let index = 0; index < speed.sources.length; index += 1) {
    if (
      !isRangePreservingSpeedEasing(
        speed.easingTypes[index],
        speed.easingLefts[index],
        speed.easingRights[index],
      )
    ) {
      return null;
    }
    const start = speed.startValues[index];
    const end = speed.endValues[index];
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return null;
    }
    const values = [start, end];
    for (const value of values) {
      const valueDirection = Math.sign(value) as FloorDirection;
      if (valueDirection === 0) {
        continue;
      }
      if (direction !== 0 && direction !== valueDirection) {
        return null;
      }
      direction = valueDirection;
    }
  }
  return direction;
}

/** Prove that the sum of all speed layers is monotone for active Hold culling. */
function canCoverActiveHoldsSpatially(speeds: readonly SpeedIntegral[]): boolean {
  let direction: FloorDirection = 0;
  for (const speed of speeds) {
    const layerDirection = speedDirection(speed);
    if (layerDirection === null) {
      return false;
    }
    if (layerDirection === 0) {
      continue;
    }
    if (direction !== 0 && direction !== layerDirection) {
      return false;
    }
    direction = layerDirection;
  }
  return true;
}

/** A compiled judge line with its event tracks, controls and visibility directory. */
export class LineRuntime {
  declare line: JudgeLine;
  declare tempo: TempoSource;
  declare factor: number;
  declare tracks: Record<
    "moveXEvents" | "moveYEvents" | "rotateEvents" | "alphaEvents",
    EventTrack[]
  >;
  declare speeds: SpeedIntegral[];
  declare floorCursor: LineFloorCursor;
  declare extended: Record<
    "scaleXEvents" | "scaleYEvents" | "colorEvents" | "textEvents" | "inclineEvents",
    EventTrack
  >;
  declare controls: Record<ControlProperty, ControlCurve>;
  declare notes: NoteEntry[];
  declare hitTimes: NoteEntry[];
  /** Time directory used by hit effects; separate from visibility culling. */
  declare holdIndex: IntervalIndex<NoteEntry>;
  declare visibility: NoteVisibilityDirectory<NoteEntry>;
  declare lastVisibilityStats: VisibilityQueryStats;
  declare hasPositionControl: boolean;
  declare hasSizeControl: boolean;
  declare hasAlphaControl: boolean;
  declare hasSkewControl: boolean;
  declare hasYControl: boolean;
  declare yEnvelope: ControlDistanceEnvelope;
  /** True only when every speed layer proves the floor is monotone. */
  declare holdActivationCoveredBySpatial: boolean;
  declare simpleState: boolean;
  declare staticScaleY: number;
  declare staticColor: number[];

  /** Compile the line's layers, controls and note indexes for sampling. */
  constructor(
    line: JudgeLine,
    tempo: TempoSource,
    defaultLineColor: readonly number[] = DEFAULT_LINE_COLOR,
  ) {
    this.line = line;
    this.tempo = tempo;
    const factor = line.bpmfactor ?? 1;
    this.factor = factor;
    this.tracks = Object.fromEntries(
      (["moveXEvents", "moveYEvents", "rotateEvents", "alphaEvents"] as const).map((type) => [
        type,
        (line.eventLayers ?? []).slice(0, 5).map((layer) => {
          const virtual: JudgeLineEvent[] = ["moveYEvents", "rotateEvents"].includes(type)
            ? (layer?.moveXEvents ?? [])
                .filter(
                  (event) =>
                    event.trajectory &&
                    (type !== "rotateEvents" || trajectoryHasRotation(event.trajectory.options)),
                )
                .map((event) => ({
                  ...event,
                  trajectoryAxis: type === "moveYEvents" ? "y" : "rotation",
                }))
            : [];
          return new EventTrack([...(layer?.[type] ?? []), ...virtual], tempo, factor, 0);
        }),
      ]),
    ) as LineRuntime["tracks"];
    this.speeds = (line.eventLayers ?? [])
      .slice(0, 5)
      .map((layer) => new SpeedIntegral(layer?.speedEvents, tempo, factor));
    this.floorCursor = new LineFloorCursor(this.speeds);
    this.holdActivationCoveredBySpatial = canCoverActiveHoldsSpatially(this.speeds);
    const defaultLine =
      !line.attachUI &&
      !line.extended?.textEvents?.length &&
      (!line.Texture || line.Texture === "line.png");
    const fallbackColor = normalizedColor(defaultLineColor);
    const defaults: [keyof LineRuntime["extended"], LineEventValue][] = [
      ["scaleXEvents", 1],
      ["scaleYEvents", defaultLine ? 1.2 : 1],
      ["colorEvents", fallbackColor],
      ["textEvents", ""],
      ["inclineEvents", 0],
    ];
    this.extended = Object.fromEntries(
      defaults.map(([type, fallback]) => [
        type,
        new EventTrack(line.extended?.[type], tempo, factor, fallback),
      ]),
    ) as LineRuntime["extended"];
    this.controls = Object.fromEntries(
      CONTROL_TRACKS.map(({ property, field }) => [
        property,
        new ControlCurve(line[field], property),
      ]),
    ) as LineRuntime["controls"];
    this.hasPositionControl = this.controls.pos.points.length > 1;
    this.hasSizeControl = this.controls.size.points.length > 1;
    this.hasAlphaControl = this.controls.alpha.points.length > 1;
    this.hasSkewControl = this.controls.skew.points.length > 1;
    this.notes = (line.notes ?? []).flatMap((note, noteIndex) => {
      if (!isOrderedBeatRange(note.startTime, note.endTime)) {
        return [];
      }
      const start = tempo.seconds(note.startTime, factor);
      const end = tempo.seconds(note.endTime, factor);
      return [
        {
          noteIndex,
          note,
          start,
          end,
          floor: this.floor(start) + (note.yOffset ?? 0),
          tail: this.floor(end) + (note.yOffset ?? 0),
        },
      ];
    });
    this.hitTimes = [...this.notes].sort((left, right) => left.start - right.start);
    this.holdIndex = new IntervalIndex(
      this.notes.filter((entry) => entry.note.type === 2),
      (entry) => entry.start,
      (entry) => entry.end,
    );
    const yControl = line.yControl;
    this.hasYControl = Boolean(
      yControl && yControl.length > 1 && yControl.some((point) => point.y !== 1),
    );
    this.yEnvelope = buildControlDistanceEnvelope(yControl);
    this.visibility = this.createVisibilityDirectory();
    this.lastVisibilityStats = emptyVisibilityStats();
    this.staticScaleY = Number(this.extended.scaleYEvents.fallback);
    this.staticColor = [...(this.extended.colorEvents.fallback as number[])];
    this.simpleState =
      !this.extended.scaleXEvents.sources.length &&
      !this.extended.scaleYEvents.sources.length &&
      !this.extended.colorEvents.sources.length &&
      !this.extended.textEvents.sources.length &&
      !this.extended.inclineEvents.sources.length &&
      !this.hasPositionControl &&
      !this.hasSizeControl &&
      !this.hasAlphaControl &&
      !this.hasSkewControl &&
      !this.hasYControl;
  }

  /**
   * Append notes to the existing directory without rebuilding it.
   *
   * Existing note references keep their indices; only appended entries and the
   * interval indexes change.
   */
  extendNotes(line: JudgeLine): void {
    const previous = this.line.notes ?? [];
    const next = line.notes ?? [];
    this.line = line;
    this.factor = line.bpmfactor ?? 1;
    for (let index = previous.length; index < next.length; index++) {
      const note = next[index];
      if (!isOrderedBeatRange(note.startTime, note.endTime)) {
        continue;
      }
      const start = this.tempo.seconds(note.startTime, this.factor);
      const end = this.tempo.seconds(note.endTime, this.factor);
      const entry = {
        noteIndex: index,
        note,
        start,
        end,
        floor: this.floor(start) + (note.yOffset ?? 0),
        tail: this.floor(end) + (note.yOffset ?? 0),
      };
      this.notes.push(entry);
      let low = 0;
      let high = this.hitTimes.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (this.hitTimes[middle].start < start) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }
      this.hitTimes.splice(low, 0, entry);
    }
    this.holdIndex.replaceItems(this.notes.filter((entry) => entry.note.type === 2));
    this.visibility.replaceItems(this.notes);
  }

  /** Rebuild only note state and indexes while reusing the compiled event tracks. */
  withLine(line: JudgeLine): LineRuntime {
    const next = Object.create(LineRuntime.prototype) as LineRuntime;
    Object.assign(next, this);
    next.line = line;
    const factor = line.bpmfactor ?? 1;
    next.factor = factor;
    next.floorCursor = new LineFloorCursor(next.speeds);
    next.notes = (line.notes ?? []).flatMap((note, noteIndex) => {
      if (!isOrderedBeatRange(note.startTime, note.endTime)) {
        return [];
      }
      const start = next.tempo.seconds(note.startTime, factor);
      const end = next.tempo.seconds(note.endTime, factor);
      return [
        {
          noteIndex,
          note,
          start,
          end,
          floor: next.floor(start) + (note.yOffset ?? 0),
          tail: next.floor(end) + (note.yOffset ?? 0),
        },
      ];
    });
    next.hitTimes = [...next.notes].sort((left, right) => left.start - right.start);
    next.visibility = next.createVisibilityDirectory();
    next.holdIndex = new IntervalIndex(
      next.notes.filter((entry) => entry.note.type === 2),
      (entry) => entry.start,
      (entry) => entry.end,
    );
    return next;
  }

  /** Rebuild changed event tracks while reusing note state, or null when shared sources changed. */
  withEventLine(line: JudgeLine): LineRuntime | null {
    if (
      line.notes !== this.line.notes ||
      line.bpmfactor !== this.factor ||
      line.Texture !== this.line.Texture ||
      line.attachUI !== this.line.attachUI ||
      !sameControlSources(this.line, line) ||
      !sameSpeedSources(this.line, line)
    ) {
      return null;
    }
    const next = Object.create(LineRuntime.prototype) as LineRuntime;
    Object.assign(next, this);
    next.line = line;
    next.factor = line.bpmfactor ?? 1;
    const newLayers = line.eventLayers ?? [];
    next.tracks = Object.fromEntries(
      (["moveXEvents", "moveYEvents", "rotateEvents", "alphaEvents"] as const).map((type) => [
        type,
        newLayers.slice(0, 5).map((layer, index) => {
          const previous = this.tracks[type]?.[index];
          const oldLayer = this.line.eventLayers?.[index];
          if (
            previous &&
            oldLayer?.[type] === layer?.[type] &&
            oldLayer?.moveXEvents === layer?.moveXEvents
          ) {
            return previous;
          }
          const sources = eventSourcesForLayer(layer, type, previous, oldLayer);
          if (previous) {
            return previous.withSources(sources);
          }
          return new EventTrack(sources, this.tempo, next.factor, 0);
        }),
      ]),
    ) as LineRuntime["tracks"];
    next.speeds = newLayers
      .slice(0, 5)
      .map(
        (layer, index) =>
          this.speeds[index] ?? new SpeedIntegral(layer?.speedEvents, this.tempo, next.factor),
      );
    next.floorCursor = new LineFloorCursor(next.speeds);
    const defaults: [keyof LineRuntime["extended"], LineEventValue][] = [
      ["scaleXEvents", 1],
      ["scaleYEvents", this.staticScaleY],
      ["colorEvents", this.staticColor],
      ["textEvents", ""],
      ["inclineEvents", 0],
    ];
    next.extended = Object.fromEntries(
      defaults.map(([type, fallback]) => {
        const previous = this.extended[type];
        return [type, previous.withSources((line.extended?.[type] ?? []) as JudgeLineEvent[])];
      }),
    ) as LineRuntime["extended"];
    next.staticScaleY = Number(next.extended.scaleYEvents.fallback);
    next.staticColor = [...(next.extended.colorEvents.fallback as number[])];
    next.simpleState =
      !next.extended.scaleXEvents.sources.length &&
      !next.extended.scaleYEvents.sources.length &&
      !next.extended.colorEvents.sources.length &&
      !next.extended.textEvents.sources.length &&
      !next.extended.inclineEvents.sources.length &&
      !next.hasPositionControl &&
      !next.hasSizeControl &&
      !next.hasAlphaControl &&
      !next.hasSkewControl &&
      !next.hasYControl;
    return next;
  }

  /** Accumulated floor distance at `seconds` across every speed layer. */
  floor(seconds: number): number {
    return this.floorCursor.value(seconds);
  }
  /** Sum one geometric track across all layers at `seconds`. */
  value(
    type: "moveXEvents" | "moveYEvents" | "rotateEvents" | "alphaEvents",
    seconds: number,
  ): number {
    let result = 0;
    const tracks = this.tracks[type];
    for (const track of tracks) {
      result += Number(track.value(seconds));
    }
    return result;
  }

  /** Sample the line's transform and visual channels, writing into `target` when given. */
  state(seconds: number, target?: LineState): LineState {
    const x = this.value("moveXEvents", seconds);
    const y = this.value("moveYEvents", seconds);
    const rotation = this.value("rotateEvents", seconds);
    const alpha = this.value("alphaEvents", seconds);
    if (this.simpleState) {
      const result =
        target ??
        ({
          x: 0,
          y: 0,
          rotation: 0,
          alpha: 0,
          scaleX: 1,
          scaleY: this.staticScaleY,
          color: [...this.staticColor],
          text: "",
          incline: 0,
          floor: 0,
        } satisfies LineState);
      result.x = x;
      result.y = y;
      result.rotation = rotation;
      result.alpha = alpha;
      result.scaleX = 1;
      result.scaleY = this.staticScaleY;
      result.text = "";
      result.incline = 0;
      result.floor = this.floor(seconds);
      return result;
    }
    const scaleXTrack = this.extended.scaleXEvents;
    const scaleYTrack = this.extended.scaleYEvents;
    const colorTrack = this.extended.colorEvents;
    const textTrack = this.extended.textEvents;
    const inclineTrack = this.extended.inclineEvents;
    const scaleX = scaleXTrack.sources.length ? Number(scaleXTrack.value(seconds)) : 1;
    const scaleY = scaleYTrack.sources.length
      ? Number(scaleYTrack.value(seconds))
      : Number(scaleYTrack.fallback);
    const color = colorTrack.sources.length
      ? this.colorValue(seconds, target?.color)
      : (target?.color ?? [...(colorTrack.fallback as number[])]);
    const text = textTrack.sources.length ? String(textTrack.value(seconds)) : "";
    const incline = inclineTrack.sources.length ? Number(inclineTrack.value(seconds)) : 0;
    const floor = this.floor(seconds);
    if (!target) {
      return { x, y, rotation, alpha, scaleX, scaleY, color, text, incline, floor };
    }
    target.x = x;
    target.y = y;
    target.rotation = rotation;
    target.alpha = alpha;
    target.scaleX = scaleX;
    target.scaleY = scaleY;
    target.color = color;
    target.text = text;
    target.incline = incline;
    target.floor = floor;
    return target;
  }
  /** Sample the colour track as integer RGB channels, reusing `target` when given. */
  colorValue(seconds: number, target?: number[]): number[] {
    // `colorEvents` always samples to an RGB triple; the fallback is `[237, 236, 176]`.
    const value = this.extended.colorEvents.value(seconds) as number[];
    if (!target) {
      return colorChannels(value);
    }
    target.length = value.length;
    for (let index = 0; index < value.length; index++) {
      target[index] = channelInteger(value[index]);
    }
    return target;
  }

  /** Fill `result` with conservative candidates visible around `seconds`. */
  visibleNotes(
    seconds: number,
    state: LineState,
    radius = 1600,
    result: NoteEntry[] = [],
  ): NoteEntry[] {
    result.length = 0;
    if (state.alpha < 0) {
      this.lastVisibilityStats = emptyVisibilityStats();
      return result;
    }
    const queryStarted = performance.now();
    this.visibility.query(seconds, state.floor, radius, result);
    const indexMs = performance.now() - queryStarted;
    if (this.hasYControl && result.length > 1) {
      result.sort((left, right) => (left.noteIndex ?? 0) - (right.noteIndex ?? 0));
    }
    const candidateCount = result.length;
    let write = 0;
    for (const entry of result) {
      if (entry.end < seconds || entry.start - seconds > (entry.note.visibleTime ?? 999999)) {
        continue;
      }
      if (
        this.line.isCover === 1 &&
        (entry.note.speed ?? 1) !== 0 &&
        (entry.note.type === 2 ? entry.tail : entry.floor) < state.floor
      ) {
        continue;
      }
      result[write++] = entry;
    }
    result.length = write;
    this.lastVisibilityStats = {
      ...this.visibility.lastQueryStats,
      candidateCount,
      visibleCount: write,
      indexMs,
    };
    return result;
  }

  /** Build the conservative candidate directory for this line's distance model. */
  private createVisibilityDirectory(): NoteVisibilityDirectory<NoteEntry> {
    return new NoteVisibilityDirectory(this.notes, {
      floorExpansionFactor: (entry) => this.noteFloorExpansionFactor(entry),
      holdActivationCoveredBySpatial: this.holdActivationCoveredBySpatial,
    });
  }

  /**
   * Return a safe floor-to-screen expansion factor for one note.
   *
   * `note.speed` is a constant multiplier. Its sign changes direction but not
   * the radius bound, while zero makes every floor position equally close in
   * the vertical channel. Line speed events are already folded into the exact
   * sampled `state.floor`, so they do not belong in this multiplier.
   *
   * A Hold uses its floor distance before activation and its head distance
   * while active. The directory therefore indexes finite-speed Holds spatially
   * for the first phase and unions them with the active-time directory; zero
   * and non-finite speeds stay in the time fallback.
   */
  private noteFloorExpansionFactor(entry: NoteEntry): number {
    const speed = Number(entry.note.speed ?? 1);
    if (!Number.isFinite(speed) || speed === 0) {
      return Number.POSITIVE_INFINITY;
    }
    if (entry.note.type === 2) {
      return 1 / Math.abs(speed);
    }
    if (this.hasYControl) {
      if (!this.yEnvelope.certified || this.yEnvelope.minAbsValue <= 0) {
        return Number.POSITIVE_INFINITY;
      }
      return 1 / (Math.abs(speed) * this.yEnvelope.minAbsValue);
    }
    return 1 / Math.abs(speed);
  }

  /** Sample one note's local position and visuals relative to the line state. */
  noteState(entry: NoteEntry, state: LineState, seconds: number, result?: NoteState): NoteState {
    const note = entry.note;
    const activeHold = note.type === 2 && entry.start < seconds;
    const distance = activeHold ? (note.yOffset ?? 0) : entry.floor - state.floor;
    const speed = note.speed ?? 1;
    const side = noteIsAbove(note) ? 1 : -1;
    const isHold = note.type === 2;
    const positionX = note.positionX ?? 0;
    const positionFactor =
      isHold || !this.hasPositionControl ? 1 : this.controls.pos.value(distance);
    const verticalFactor = !isHold && this.hasYControl ? this.controls.y.value(distance) : 1;
    let horizontal = positionX * positionFactor;
    const vertical = distance * speed * side * verticalFactor;
    if (!isHold && Math.abs(state.incline as number) > 0.01) {
      horizontal -=
        Math.tan(((positionX / 675) * (state.incline as number) * Math.PI) / 180) *
        distance *
        speed *
        side;
    }
    const target =
      result ??
      ({ x: 0, y: 0, tail: 0, size: 0, alpha: 0, skew: 0, showHead: false } satisfies NoteState);
    target.x = horizontal;
    target.y = vertical;
    target.tail = (entry.tail - state.floor) * speed * side;
    target.size =
      (note.size ?? 1) * (isHold || !this.hasSizeControl ? 1 : this.controls.size.value(distance));
    target.alpha =
      ((note.alpha ?? 255) / 255) *
      (this.hasAlphaControl ? this.controls.alpha.value(distance) : 1);
    target.skew =
      isHold || !this.hasSkewControl ? 0 : positionX * this.controls.skew.value(distance);
    // A zero-length Hold draws only its tail so the two cap sprites do not overlap.
    const zeroLength = isHold && Math.abs(target.tail - target.y) < 1e-6;
    target.showHead = !activeHold && !zeroLength;
    return target;
  }
}

/** A zeroed line state used while a paged line is not materialized. */
const EMPTY_LINE_STATE: SampledLineState = Object.freeze({
  x: 0,
  y: 0,
  rotation: 0,
  alpha: 0,
  scaleX: 1,
  scaleY: 1,
  color: Object.freeze([...DEFAULT_LINE_COLOR]) as unknown as number[],
  text: "",
  incline: 0,
  floor: 0,
}) as SampledLineState;

/** Return the shared empty state for an unmaterialized line. */
function emptyLineState(): SampledLineState {
  return EMPTY_LINE_STATE;
}

/** Copy a sampled line state into `target`, or into a new object. */
function copyLineState(
  target: SampledLineState | undefined,
  source: SampledLineState,
): SampledLineState {
  const next =
    target ??
    ({
      x: source.x,
      y: source.y,
      rotation: source.rotation,
      alpha: source.alpha,
      scaleX: source.scaleX,
      scaleY: source.scaleY,
      color: source.color,
      text: source.text,
      incline: source.incline,
      floor: source.floor,
    } satisfies SampledLineState);
  next.x = source.x;
  next.y = source.y;
  next.rotation = source.rotation;
  next.alpha = source.alpha;
  next.scaleX = source.scaleX;
  next.scaleY = source.scaleY;
  next.color = source.color;
  next.text = source.text;
  next.incline = source.incline;
  next.floor = source.floor;
  return next;
}

/** Build track sources for a layer, including virtual Y and rotation trajectory copies. */
function eventSourcesForLayer(
  layer: NonNullable<JudgeLine["eventLayers"]>[number] | undefined,
  type: "moveXEvents" | "moveYEvents" | "rotateEvents" | "alphaEvents",
  previousTrack?: EventTrack,
  previousLayer?: NonNullable<JudgeLine["eventLayers"]>[number],
): JudgeLineEvent[] {
  if (!["moveYEvents", "rotateEvents"].includes(type)) {
    return [...(layer?.[type] ?? [])];
  }
  const matches = (event: JudgeLineEvent): boolean =>
    Boolean(
      event.trajectory &&
      (type !== "rotateEvents" || trajectoryHasRotation(event.trajectory.options)),
    );
  const previousVirtual = new Map<JudgeLineEvent, JudgeLineEvent>();
  if (previousTrack && previousLayer) {
    const previousMoveX = (previousLayer.moveXEvents ?? []).filter(matches);
    const axis = type === "moveYEvents" ? "y" : "rotation";
    // `EventTrack` sorts its sources by start time, so the virtual copies are
    // not necessarily after the base events. Match them by the trajectory they
    // came from and their beat span instead of an array offset.
    const byTrajectory = new Map<object, JudgeLineEvent[]>();
    for (const source of previousTrack.sources) {
      if (!source.trajectory || source.trajectoryAxis !== axis) {
        continue;
      }
      const entries = byTrajectory.get(source.trajectory) ?? [];
      entries.push(source);
      byTrajectory.set(source.trajectory, entries);
    }
    for (const event of previousMoveX) {
      if (!event.trajectory) {
        continue;
      }
      const source = byTrajectory
        .get(event.trajectory)
        ?.find(
          (candidate) =>
            beatValue(candidate.startTime) === beatValue(event.startTime) &&
            beatValue(candidate.endTime) === beatValue(event.endTime),
        );
      if (source) {
        previousVirtual.set(event, source);
      }
    }
  }
  const virtual = (layer?.moveXEvents ?? []).filter(matches).map(
    (event): JudgeLineEvent =>
      previousVirtual.get(event) ?? {
        ...event,
        trajectoryAxis: type === "moveYEvents" ? "y" : "rotation",
      },
  );
  return [...(layer?.[type] ?? []), ...virtual];
}

/** True when both lines share every control-curve array. */
function sameControlSources(previous: JudgeLine, next: JudgeLine): boolean {
  return (
    previous.alphaControl === next.alphaControl &&
    previous.posControl === next.posControl &&
    previous.sizeControl === next.sizeControl &&
    previous.skewControl === next.skewControl &&
    previous.yControl === next.yControl
  );
}

/** True when both lines share every layer speed-event array. */
function sameSpeedSources(previous: JudgeLine, next: JudgeLine): boolean {
  const before = previous.eventLayers ?? [];
  const after = next.eventLayers ?? [];
  if (before.length !== after.length) {
    return false;
  }
  for (let index = 0; index < before.length; index += 1) {
    if (before[index]?.speedEvents !== after[index]?.speedEvents) {
      return false;
    }
  }
  return true;
}

/** True when `next` keeps every existing note and only appends new ones. */
function extendsNotes(previous: JudgeLine, next: JudgeLine): boolean {
  const before = previous.notes ?? [];
  const after = next.notes ?? [];
  if (after.length <= before.length) {
    return false;
  }
  for (let index = 0; index < before.length; index++) {
    if (before[index] !== after[index]) {
      return false;
    }
  }
  return true;
}

/** True when both lines share every event, control and factor source. */
function sameLineSources(previous: JudgeLine, next: JudgeLine): boolean {
  return (
    previous.eventLayers === next.eventLayers &&
    previous.extended === next.extended &&
    previous.bpmfactor === next.bpmfactor &&
    previous.attachUI === next.attachUI &&
    previous.Texture === next.Texture &&
    previous.alphaControl === next.alphaControl &&
    previous.posControl === next.posControl &&
    previous.sizeControl === next.sizeControl &&
    previous.skewControl === next.skewControl &&
    previous.yControl === next.yControl
  );
}

/** Compiled chart runtime: line order plus per-line sampling and rebuild caches. */
export class SceneRuntime {
  declare cache: WeakMap<JudgeLine, LineRuntime>;
  declare chart: Chart | null;
  declare tempo: TempoSource | null;
  declare lines: LineRuntime[];
  declare order: number[];
  declare orderLines: JudgeLine[];
  declare orderValues: Float64Array;
  declare sortedOrder: number[];
  declare defaultLineColor: number[];
  private sampleStatus = new Uint8Array();
  private sampledSeconds = Number.NaN;
  private sampledTempo: TempoSource | null = null;
  private sampledStates: SampledLineState[] | null = null;
  private lineSamples = new WeakMap<LineRuntime, { seconds: number; state: SampledLineState }>();
  private runtimeById = new Map<string, LineRuntime>();

  /** Create an empty runtime with the default line colour. */
  constructor() {
    this.defaultLineColor = [...DEFAULT_LINE_COLOR];
    this.clear();
  }
  /** Drop every compiled line and cached sample. */
  clear(): void {
    this.cache = new WeakMap();
    this.chart = null;
    this.tempo = null;
    this.lines = [];
    this.order = [];
    this.orderLines = [];
    this.orderValues = new Float64Array();
    this.sortedOrder = [];
    this.sampleStatus = new Uint8Array();
    this.sampledSeconds = Number.NaN;
    this.sampledTempo = null;
    this.sampledStates = null;
    this.lineSamples = new WeakMap();
    this.runtimeById.clear();
  }

  /** Compile `chart`, reusing or incrementally updating line runtimes where possible. */
  compile(
    chart: Chart,
    tempo: TempoSource,
    defaultLineColor: readonly number[] = this.defaultLineColor,
  ): void {
    const nextColor = normalizedColor(defaultLineColor);
    const colorChanged = !colorsEqual(this.defaultLineColor, nextColor);
    if (this.chart === chart && this.tempo === tempo && !colorChanged) {
      return;
    }
    if (this.tempo !== tempo || colorChanged) {
      this.cache = new WeakMap();
      this.runtimeById.clear();
      this.tempo = tempo;
    }
    this.defaultLineColor = nextColor;
    this.chart = chart;
    this.sampledSeconds = Number.NaN;
    this.sampledStates = null;
    const sourceLines = chart.judgeLineList ?? [];
    const previousById = this.runtimeById;
    this.runtimeById = new Map();
    this.lines = sourceLines.map((line) => {
      if (isPlaceholderLine(line)) {
        return undefined as unknown as LineRuntime;
      }
      let runtime = this.cache.get(line);
      if (!runtime) {
        const previous = typeof line.id === "string" ? previousById.get(line.id) : undefined;
        if (previous && sameLineSources(previous.line, line)) {
          if (extendsNotes(previous.line, line)) {
            const previousLine = previous.line;
            previous.extendNotes(line);
            // The runtime mutated in place, so drop the earlier chart's cache
            // entry; undo rebuilds that note directory from scratch.
            this.cache.delete(previousLine);
            runtime = previous;
          } else {
            runtime = previous.withLine(line);
          }
        } else {
          const eventRuntime = previous?.withEventLine(line);
          runtime = eventRuntime ?? new LineRuntime(line, tempo, this.defaultLineColor);
        }
        this.cache.set(line, runtime);
      }
      if (typeof line.id === "string") {
        this.runtimeById.set(line.id, runtime);
      }
      return runtime;
    });
    const sameOrder =
      sourceLines.length === this.orderLines.length &&
      sourceLines.every(
        (line, index) =>
          line === this.orderLines[index] && Number(line.zOrder ?? 0) === this.orderValues[index],
      );
    if (!sameOrder) {
      this.orderLines = [...sourceLines];
      this.orderValues = Float64Array.from(sourceLines, (line) => Number(line.zOrder ?? 0));
      this.sortedOrder = sourceLines
        .map((unused, index) => index)
        .sort((left, right) => this.orderValues[left] - this.orderValues[right] || left - right);
    }
    this.order = this.sortedOrder;
  }

  /**
   * Return a sampler resolving one line's world state at `seconds`.
   *
   * Parent transforms are resolved lazily and cached per sample time.
   */
  sampler(
    seconds: number,
    states: SampledLineState[] = [],
    status = new Uint8Array(this.lines.length),
  ): (index: number) => SampledLineState {
    states.length = this.lines.length;
    const resolve = (index: number): boolean => {
      if (status[index] === 2) {
        return true;
      }
      if (status[index] === 1) {
        return false;
      }
      status[index] = 1;
      const runtime = this.lines[index];
      if (!runtime) {
        states[index] = emptyLineState();
        status[index] = 2;
        return true;
      }
      const line = runtime.line;
      const parent = lineParentIndex(line.father);
      const cached = this.lineSamples.get(runtime);
      let state: SampledLineState;
      if (cached && cached.seconds === seconds) {
        state = copyLineState(states[index], cached.state);
        states[index] = state;
      } else {
        state = runtime.state(seconds, states[index]);
        states[index] = state;
        this.lineSamples.set(runtime, {
          seconds,
          state: copyLineState(undefined, state),
        });
      }
      if (Number.isInteger(parent) && parent >= 0 && parent < this.lines.length) {
        if (!resolve(parent)) {
          status[index] = 2;
          return false;
        }
        const ancestor = states[parent];
        const local = states[index];
        if (ancestor === undefined || local === undefined) {
          status[index] = 2;
          return false;
        }
        const angle = (-ancestor.rotation * Math.PI) / 180;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const localX = local.x;
        const localY = local.y;
        local.x = ancestor.x + localX * cosine - localY * sine;
        local.y = ancestor.y + localX * sine + localY * cosine;
        local.rotation += inheritsParentRotation(line) ? ancestor.rotation : 0;
      }
      status[index] = 2;
      return true;
    };
    return (index: number) => {
      if (index < 0 || index >= this.lines.length) {
        throw new RangeError(`Line index out of range: ${index}`);
      }
      if (!this.lines[index]) {
        return emptyLineState();
      }
      resolve(index);
      const state = states[index];
      if (!state) {
        throw new Error(`Unable to sample line: ${index}`);
      }
      return state;
    };
  }

  /** Sample every line into a new array. */
  sample(seconds: number): SampledLineState[] {
    return this.sampleInto(seconds, []);
  }

  /** Sample into caller-owned storage so frame renderers can avoid array churn. */
  sampleInto(seconds: number, target: SampledLineState[]): SampledLineState[] {
    if (this.sampledStates && this.sampledSeconds === seconds && this.sampledTempo === this.tempo) {
      if (target === this.sampledStates) {
        return target;
      }
      target.length = this.sampledStates.length;
      for (let index = 0; index < this.sampledStates.length; index += 1) {
        target[index] = this.sampledStates[index];
      }
      return target;
    }
    if (this.sampleStatus.length !== this.lines.length) {
      this.sampleStatus = new Uint8Array(this.lines.length);
    } else {
      this.sampleStatus.fill(0);
    }
    const sample = this.sampler(seconds, target, this.sampleStatus);
    for (let index = 0; index < this.lines.length; index++) {
      if (!this.lines[index]) {
        target[index] = emptyLineState();
        continue;
      }
      sample(index);
    }
    this.sampledSeconds = seconds;
    this.sampledTempo = this.tempo;
    this.sampledStates = target;
    return target;
  }
}
