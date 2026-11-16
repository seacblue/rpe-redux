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
import { noteAlpha } from "../optionalFeatures.ts";
import { renderDetailedProfileEnabled } from "../../../diagnostics/renderMetrics.ts";
import { contentFingerprint } from "../chartContentHash.ts";
import type { JudgeLine, JudgeLineEvent, LineEventValue } from "../chart.ts";
import type { ControlPoint } from "../chart.ts";
import type { Chart } from "../chart.ts";
import type { TempoSource } from "../timing/events.ts";
import type { NoteChangeHint } from "./noteChangeHints.ts";

/** A point of a line control curve, tagged with the property it interpolates. */
export type ControlCurvePoint = ControlPoint;

export type ControlProperty = ControlTrackProperty;

/** Built-in colour used when a renderer does not supply a user preference. */
export const DEFAULT_LINE_COLOR = [237, 236, 176] as const;

/** The geometric channels a line samples each frame, in `sampleChannels` order. */
const CHANNELS = ["moveXEvents", "moveYEvents", "rotateEvents", "alphaEvents"] as const;
const CHANNEL_COUNT = CHANNELS.length;

/** Reusable broad-phase candidates for a line whose spatial query is invariant. */
interface VisibilityCandidateCache {
  floor: number;
  radius: number;
  entries: NoteEntry[];
}

/** Retains the expensive Y-control ordering while the directory returns the same candidates. */
interface VisibilityOrderCache {
  candidates: NoteEntry[];
  ordered: NoteEntry[];
}

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
  private readonly positions: number[];
  private readonly amplitudes: number[];
  /**
   * True when every point carries the same amplitude, so the curve cannot change anything.
   *
   * An exporter writes a two-point curve for every property on every line even when the
   * value never changes: on a real chart all 741 lines carry `pos:1 ... pos:1` and
   * `size:1 ... size:1`. Sampling such a curve is cheap, but the mere presence of more than
   * one point used to disable the whole-line fast path, which is what made sampling cost
   * 68% of a frame.
   */
  readonly isConstant: boolean;
  /**
   * True when the curve cannot move its property away from the neutral value.
   *
   * This is the condition that makes a control track irrelevant, and it is stricter than
   * `isConstant`: a flat curve at `size:2` is constant but still scales every note, so it
   * must keep the slow path.
   */
  readonly isNeutral: boolean;

  /** Sort control points by distance so evaluation always runs low to high. */
  constructor(points: ControlCurvePoint[] | undefined, property: ControlProperty, neutral: number) {
    this.property = property;
    // RPE charts are serialized in either direction depending on the exporter.
    // Evaluation is always from the smaller distance to the larger one.
    this.points = [...(points ?? [])].sort((left, right) => (left.x ?? 0) - (right.x ?? 0));
    this.positions = this.points.map((point) => point.x ?? 0);
    this.amplitudes = this.points.map((point) => point[property] as number);
    this.isConstant =
      this.amplitudes.length === 0 ||
      this.amplitudes.every((value) => value === this.amplitudes[0]);
    this.isNeutral = this.amplitudes.every((value) => value === neutral);
  }
  /** Interpolate the controlled property at `distance`, clamped to the endpoint values. */
  value(distance: number): number {
    const points = this.points;
    const positions = this.positions;
    const amplitudes = this.amplitudes;
    if (points.length <= 1) {
      return points.length ? amplitudes[0] : 1;
    }
    if (points.length === 2 && amplitudes[0] === amplitudes[1]) {
      return amplitudes[0];
    }
    // Keep the binary search allocation-free: this method is sampled once per
    // controlled note property and frame during preview playback.
    let low = 0;
    let high = positions.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (positions[middle] < distance) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    if (!low) {
      return amplitudes[0];
    }
    if (low === points.length) {
      return amplitudes[amplitudes.length - 1];
    }
    const startPosition = positions[low - 1];
    const endPosition = positions[low];
    const span = endPosition - startPosition;
    return (
      amplitudes[low - 1] +
      (amplitudes[low] - amplitudes[low - 1]) *
        (span ? easing((distance - startPosition) / span, points[low].easing ?? 1) : 1)
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

/** Low-overhead counters for one SceneRuntime sample pass. */
export interface SceneSampleStats {
  sampledLineCount: number;
  staticLineCacheHits: number;
  continuousLineCount: number;
  parentComposeCount: number;
  stateCopyCount: number;
}

/** Retains one composed world state while both its local and parent inputs stay identical. */
interface WorldStateCacheEntry {
  localVersion: number;
  parentVersion: number;
  state: SampledLineState;
}

/** Create reusable sample counters without retaining frame data. */
function emptySceneSampleStats(): SceneSampleStats {
  return {
    sampledLineCount: 0,
    staticLineCacheHits: 0,
    continuousLineCount: 0,
    parentComposeCount: 0,
    stateCopyCount: 0,
  };
}

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

/** Reset one line's reusable visibility stats without allocating a new object. */
function resetVisibilityStats(target: VisibilityQueryStats): void {
  target.candidateCount = 0;
  target.visibleCount = 0;
  target.spatialCandidateCount = 0;
  target.temporalCandidateCount = 0;
  target.holdCandidateCount = 0;
  target.indexMs = 0;
}

/** True when ordinary notes need no control-curve or incline sampling. */
function computeSimpleNoteState(runtime: LineRuntime): boolean {
  return (
    !runtime.hasPositionControl &&
    !runtime.hasSizeControl &&
    !runtime.hasAlphaControl &&
    !runtime.hasSkewControl &&
    !runtime.extended.inclineEvents.sources.length
  );
}

/** True when every extended visual track and control curve is constant. */
function computeSimpleState(runtime: LineRuntime): boolean {
  return (
    constantTrackEquals(runtime.extended.scaleXEvents, 1) &&
    constantTrackEquals(runtime.extended.scaleYEvents, runtime.staticScaleY) &&
    !runtime.extended.colorEvents.sources.length &&
    !runtime.extended.textEvents.sources.length &&
    // A flat incline at its neutral value cannot tilt a note, and exported charts put one
    // on every line. Requiring an empty track excluded every line from the fast path.
    isNeutralIncline(runtime.extended.inclineEvents) &&
    !runtime.hasPositionControl &&
    !runtime.hasSizeControl &&
    !runtime.hasAlphaControl &&
    !runtime.hasSkewControl &&
    !runtime.hasYControl
  );
}

/** True when a numeric event track has the same value as its fallback everywhere. */
function constantTrackEquals(track: EventTrack, expected: number): boolean {
  return track.constantValue() === expected;
}

/** True when an incline track cannot move a note away from zero. */
function isNeutralIncline(track: EventTrack): boolean {
  return track.constantValue() === 0;
}

/** Sample one pre-filtered channel track list without allocating a temporary array. */
function sampleTrackList(tracks: readonly EventTrack[], offset: number, seconds: number): number {
  if (tracks.length === 0) {
    return offset;
  }
  if (tracks.length === 1) {
    return offset + tracks[0].sampleNumeric(seconds);
  }
  let result = offset;
  for (let index = 0; index < tracks.length; index += 1) {
    result += tracks[index].sampleNumeric(seconds);
  }
  return result;
}

/** True when sampling can skip all event-track and floor lookups. */
function computeStaticState(runtime: LineRuntime): boolean {
  return (
    constantTrackEquals(runtime.extended.scaleXEvents, 1) &&
    constantTrackEquals(runtime.extended.scaleYEvents, runtime.staticScaleY) &&
    !runtime.extended.colorEvents.sources.length &&
    !runtime.extended.textEvents.sources.length &&
    isNeutralIncline(runtime.extended.inclineEvents) &&
    runtime.animatedTrackList.every((tracks) => tracks.length === 0) &&
    runtime.speeds.every((speed) => speed.sources.length === 0)
  );
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
  /**
   * The layer tracks that can actually change over time, per channel.
   *
   * A flat track contributes the same number at every instant, so it is removed from this
   * list and its value is folded into `trackOffsets`. Most exported charts write a flat
   * track on several layers, which made sampling walk tracks that could never move.
   */
  declare animatedTracks: Record<
    "moveXEvents" | "moveYEvents" | "rotateEvents" | "alphaEvents",
    EventTrack[]
  >;
  /** Sum of the flat tracks removed from `animatedTracks`, per channel. */
  declare trackOffsets: Record<
    "moveXEvents" | "moveYEvents" | "rotateEvents" | "alphaEvents",
    number
  >;
  /**
   * The same two records as flat arrays, indexed by channel for the per-frame sample.
   *
   * `state` reads every channel at one instant, so an index loop over these replaces four
   * string-keyed lookups per line per frame.
   */
  declare animatedTrackList: EventTrack[][];
  declare trackOffsetList: Float64Array;
  /**
   * Per-line channel output reused by every `state` call.
   *
   * `state` writes straight into the target it already owns, so this one array is only the
   * hand-off between the sample loop and the field writes; it never escapes the runtime.
   */
  declare readonly channelScratch: Float64Array;
  declare speeds: SpeedIntegral[];
  declare floorCursor: LineFloorCursor;
  declare extended: Record<
    "scaleXEvents" | "scaleYEvents" | "colorEvents" | "textEvents" | "inclineEvents",
    EventTrack
  >;
  declare controls: Record<ControlProperty, ControlCurve>;
  declare notes: NoteEntry[];
  /** Direct source-index lookup used by copy-on-write visual note edits. */
  declare noteEntriesByIndex: Array<NoteEntry | undefined>;
  declare hitTimes: NoteEntry[];
  /** Time directory used by hit effects; separate from visibility culling. */
  declare holdIndex: IntervalIndex<NoteEntry>;
  declare visibility: NoteVisibilityDirectory<NoteEntry>;
  declare lastVisibilityStats: VisibilityQueryStats;
  private visibilityCandidateCache?: VisibilityCandidateCache;
  private visibilityOrderCache?: VisibilityOrderCache;
  declare hasPositionControl: boolean;
  declare hasSizeControl: boolean;
  declare hasAlphaControl: boolean;
  declare hasSkewControl: boolean;
  declare hasYControl: boolean;
  /** True when ordinary notes need no control-curve or incline sampling. */
  declare simpleNoteState: boolean;
  declare yEnvelope: ControlDistanceEnvelope;
  /** True only when every speed layer proves the floor is monotone. */
  declare holdActivationCoveredBySpatial: boolean;
  declare simpleState: boolean;
  /** True when sampling can skip all event-track and floor lookups. */
  declare staticState: boolean;
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
    this.channelScratch = new Float64Array(CHANNEL_COUNT);
    this.applyTrackOffsets();
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
      CONTROL_TRACKS.map(({ property, field, neutral }) => [
        property,
        new ControlCurve(line[field], property, neutral),
      ]),
    ) as LineRuntime["controls"];
    // A curve that never leaves its neutral value cannot change a note, so it must not
    // disable the whole-line fast path. Exported RPE charts write a flat two-point curve on
    // every line for every property, and treating that as "controlled" made every line take
    // the slow sample.
    this.hasPositionControl = !this.controls.pos.isNeutral;
    this.hasSizeControl = !this.controls.size.isNeutral;
    this.hasAlphaControl = !this.controls.alpha.isNeutral;
    this.hasSkewControl = !this.controls.skew.isNeutral;
    this.simpleNoteState = computeSimpleNoteState(this);
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
    this.noteEntriesByIndex = [];
    for (const entry of this.notes) {
      this.noteEntriesByIndex[entry.noteIndex ?? 0] = entry;
    }
    if ((line.notes?.length ?? 0) >= 64) {
      contentFingerprint(line.notes, { ignoreIds: true });
    }
    this.hitTimes = [...this.notes].sort((left, right) => left.start - right.start);
    this.holdIndex = new IntervalIndex(
      this.notes.filter((entry) => entry.note.type === 2),
      (entry) => entry.start,
      (entry) => entry.end,
    );
    const yControl = line.yControl;
    // Same rule as the other control tracks: a curve that never leaves `y:1` is neutral.
    this.hasYControl = !this.controls.y.isNeutral;
    this.yEnvelope = buildControlDistanceEnvelope(yControl);
    this.visibility = this.createVisibilityDirectory();
    this.lastVisibilityStats = emptyVisibilityStats();
    this.staticScaleY = Number(this.extended.scaleYEvents.fallback);
    this.staticColor = [...(this.extended.colorEvents.fallback as number[])];
    this.simpleState = computeSimpleState(this);
    this.staticState = computeStaticState(this);
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
      const startFloor = this.floor(start);
      const endFloor = this.floor(end);
      const offset = note.yOffset ?? 0;
      const entry = {
        noteIndex: index,
        note,
        start,
        end,
        startFloor,
        endFloor,
        floor: startFloor + offset,
        tail: endFloor + offset,
      };
      this.notes.push(entry);
      this.noteEntriesByIndex[index] = entry;
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
    this.visibilityCandidateCache = undefined;
    this.visibilityOrderCache = undefined;
  }

  /** Rebuild only note state and indexes while reusing the compiled event tracks. */
  withLine(line: JudgeLine, hint?: NoteChangeHint): LineRuntime {
    const next = Object.create(LineRuntime.prototype) as LineRuntime;
    Object.assign(next, this);
    next.line = line;
    const factor = line.bpmfactor ?? 1;
    next.factor = factor;
    const sourceNotes = line.notes ?? [];
    const reusableChanges =
      hint?.kind === "visual" && sourceNotes.length === (this.line.notes ?? []).length
        ? hint.noteIndexes
        : hint
          ? null
          : reusableNoteChanges(this, line);
    if (reusableChanges) {
      // Position, size, alpha and above/below edits do not change timing,
      // floor bounds, or broad-phase membership. Keep the expensive indexes
      // and transfer the entry storage to the replacement runtime. Updating
      // the entry references keeps the renderer's direct `entry.note` reads
      // correct without rebuilding every NoteEntry for a one-note edit.
      for (const noteIndex of reusableChanges) {
        const entry = next.noteEntriesByIndex[noteIndex];
        const current = sourceNotes[noteIndex];
        if (entry && current) {
          entry.note = current;
        }
      }
      return next;
    }
    next.visibilityCandidateCache = undefined;
    next.visibilityOrderCache = undefined;
    next.floorCursor = new LineFloorCursor(next.speeds);
    next.notes = (line.notes ?? []).flatMap((note, noteIndex) => {
      if (!isOrderedBeatRange(note.startTime, note.endTime)) {
        return [];
      }
      const start = next.tempo.seconds(note.startTime, factor);
      const end = next.tempo.seconds(note.endTime, factor);
      const startFloor = next.floor(start);
      const endFloor = next.floor(end);
      const offset = note.yOffset ?? 0;
      return [
        {
          noteIndex,
          note,
          start,
          end,
          startFloor,
          endFloor,
          floor: startFloor + offset,
          tail: endFloor + offset,
        },
      ];
    });
    next.noteEntriesByIndex = [];
    for (const entry of next.notes) {
      next.noteEntriesByIndex[entry.noteIndex ?? 0] = entry;
    }
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
    next.applyTrackOffsets();
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
    next.simpleState = computeSimpleState(next);
    next.simpleNoteState = computeSimpleNoteState(next);
    next.staticState = computeStaticState(next);
    return next;
  }

  /**
   * Split each channel's layer tracks into the ones that can animate and a flat offset.
   *
   * Called wherever `tracks` is rebuilt, so `value` never reads a track that cannot move.
   */
  private applyTrackOffsets(): void {
    const animatedTracks = {} as LineRuntime["animatedTracks"];
    const trackOffsets = {} as LineRuntime["trackOffsets"];
    const animatedTrackList: EventTrack[][] = [];
    const trackOffsetList = new Float64Array(CHANNEL_COUNT);
    for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
      const type = CHANNELS[channel];
      const animated: EventTrack[] = [];
      let offset = 0;
      for (const track of this.tracks[type]) {
        const constant = track.constantValue();
        if (constant === null) {
          animated.push(track);
        } else {
          offset += constant;
        }
      }
      animatedTracks[type] = animated;
      trackOffsets[type] = offset;
      animatedTrackList.push(animated);
      trackOffsetList[channel] = offset;
    }
    this.animatedTracks = animatedTracks;
    this.trackOffsets = trackOffsets;
    this.animatedTrackList = animatedTrackList;
    this.trackOffsetList = trackOffsetList;
  }

  /** Accumulated floor distance at `seconds` across every speed layer. */
  floor(seconds: number): number {
    return this.floorCursor.value(seconds);
  }
  /**
   * Sum one geometric track across all layers at `seconds`.
   *
   * Layers whose track never changes are folded into `trackOffsets` at compile time. On a
   * real chart 62% of layer tracks are flat — they hold 5.5% of the events but cost the same
   * per-frame lookup as a real curve — so skipping them is the difference between sampling
   * four tracks per line and sampling four tracks per line *plus* their constant neighbours.
   */
  value(
    type: "moveXEvents" | "moveYEvents" | "rotateEvents" | "alphaEvents",
    seconds: number,
  ): number {
    const tracks = this.animatedTracks[type];
    let result = this.trackOffsets[type];
    if (!tracks.length) {
      return result;
    }
    if (tracks.length === 1) {
      return result + Number(tracks[0].value(seconds));
    }
    for (const track of tracks) {
      result += Number(track.value(seconds));
    }
    return result;
  }

  /**
   * Sample all four geometric channels at `seconds` into `into`.
   *
   * `state` needs every channel at the same instant, and calling `value` four times meant
   * four string-keyed property lookups on two records plus a `Number()` per layer. Indexing
   * two flat arrays once per channel is the same work without the lookups, and it is what
   * sampling a 741-line chart does most of.
   */
  sampleChannels(seconds: number, into: Float64Array): void {
    // The channel count is fixed and most exported lines have zero or one
    // animated track per channel. Unroll that hot path so playback does not
    // pay for a channel-index loop and repeated array/property lookups on all
    // 741 lines. Multi-track channels keep the general accumulation path.
    into[0] = sampleTrackList(this.animatedTrackList[0], this.trackOffsetList[0], seconds);
    into[1] = sampleTrackList(this.animatedTrackList[1], this.trackOffsetList[1], seconds);
    into[2] = sampleTrackList(this.animatedTrackList[2], this.trackOffsetList[2], seconds);
    into[3] = sampleTrackList(this.animatedTrackList[3], this.trackOffsetList[3], seconds);
  }

  /** Sample the line's transform and visual channels, optionally skipping floor on empty lines. */
  state(seconds: number, target?: LineState, includeFloorForEmptyLines = true): LineState {
    if (this.staticState) {
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
      result.x = 0;
      result.y = 0;
      result.rotation = 0;
      result.alpha = 0;
      result.scaleX = 1;
      result.scaleY = this.staticScaleY;
      result.color = this.staticColor;
      result.text = "";
      result.incline = 0;
      result.floor = 0;
      return result;
    }
    // One index loop fills all four channels, replacing four string-keyed `value` calls.
    const channels = this.channelScratch;
    this.sampleChannels(seconds, channels);
    const x = channels[0];
    const y = channels[1];
    const rotation = channels[2];
    const alpha = channels[3];
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
      result.floor = includeFloorForEmptyLines || this.notes.length > 0 ? this.floor(seconds) : 0;
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
    const floor = includeFloorForEmptyLines || this.notes.length > 0 ? this.floor(seconds) : 0;
    if (!target) {
      return {
        x,
        y,
        rotation,
        alpha,
        scaleX,
        scaleY,
        color,
        text,
        incline,
        floor,
      };
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

  /** Fill reusable note and optional Hold buffers with conservative visible candidates. */
  visibleNotes(
    seconds: number,
    state: LineState,
    radius = 1600,
    result: NoteEntry[] = [],
    holdResult?: NoteEntry[],
    measureIndex = renderDetailedProfileEnabled(),
  ): NoteEntry[] {
    result.length = 0;
    if (holdResult) {
      holdResult.length = 0;
    }
    if (this.notes.length === 0) {
      resetVisibilityStats(this.lastVisibilityStats);
      return result;
    }
    if (state.alpha < 0) {
      resetVisibilityStats(this.lastVisibilityStats);
      return result;
    }
    const reusableSpatialQuery =
      this.visibility.spatialOnly &&
      this.speeds.every((speed) => speed.sources.length === 0) &&
      this.visibilityCandidateCache?.floor === state.floor &&
      this.visibilityCandidateCache.radius === radius;
    let indexMs = 0;
    if (reusableSpatialQuery) {
      result.push(...this.visibilityCandidateCache!.entries);
    } else {
      const queryStarted = measureIndex ? performance.now() : 0;
      this.visibility.query(seconds, state.floor, radius, result);
      indexMs = measureIndex ? performance.now() - queryStarted : 0;
      if (this.visibility.spatialOnly && this.speeds.every((speed) => speed.sources.length === 0)) {
        this.visibilityCandidateCache = {
          floor: state.floor,
          radius,
          entries: [...result],
        };
      }
    }
    if (this.hasYControl && result.length > 1) {
      const orderCache = this.visibilityOrderCache;
      const sameCandidates =
        orderCache?.candidates.length === result.length &&
        orderCache.candidates.every((entry, index) => entry === result[index]);
      if (sameCandidates) {
        result.length = 0;
        result.push(...orderCache!.ordered);
      } else {
        let ordered = true;
        let previousIndex = result[0].noteIndex ?? 0;
        for (let index = 1; index < result.length; index += 1) {
          const noteIndex = result[index].noteIndex ?? 0;
          if (noteIndex < previousIndex) {
            ordered = false;
            break;
          }
          previousIndex = noteIndex;
        }
        if (!ordered) {
          result.sort((left, right) => (left.noteIndex ?? 0) - (right.noteIndex ?? 0));
        }
        this.visibilityOrderCache = {
          candidates: [...(reusableSpatialQuery ? this.visibilityCandidateCache!.entries : result)],
          ordered: [...result],
        };
      }
    }
    const candidateCount = result.length;
    let write = 0;
    let holdWrite = 0;
    for (const entry of result) {
      const note = entry.note;
      if (entry.end < seconds || entry.start - seconds > (note.visibleTime ?? 999999)) {
        continue;
      }
      if (
        this.line.isCover === 1 &&
        (note.speed ?? 1) !== 0 &&
        (note.type === 2 ? entry.tail : entry.floor) < state.floor
      ) {
        continue;
      }
      if (holdResult && note.type === 2) {
        holdResult[holdWrite++] = entry;
      } else {
        result[write++] = entry;
      }
    }
    result.length = write;
    if (holdResult) {
      holdResult.length = holdWrite;
    }
    const stats = this.lastVisibilityStats;
    stats.spatialCandidateCount = this.visibility.lastQueryStats.spatialCandidateCount;
    stats.temporalCandidateCount = this.visibility.lastQueryStats.temporalCandidateCount;
    stats.holdCandidateCount = this.visibility.lastQueryStats.holdCandidateCount;
    stats.candidateCount = candidateCount;
    stats.visibleCount = write;
    stats.indexMs = indexMs;
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
    const offset = note.yOffset ?? 0;
    // Subtract cumulative floors before adding the local
    // offset. Adding the offset to a huge floor first loses precision and makes
    // Hold lengths alternate around zero.
    const startFloor = entry.startFloor ?? entry.floor - offset;
    const endFloor = entry.endFloor ?? entry.tail - offset;
    const distance = activeHold ? offset : startFloor - state.floor + offset;
    const speed = note.speed ?? 1;
    const side = noteIsAbove(note) ? 1 : -1;
    const isHold = note.type === 2;
    const positionX = note.positionX ?? 0;
    if (!isHold && this.simpleNoteState) {
      const target =
        result ??
        ({ x: 0, y: 0, tail: 0, size: 0, alpha: 0, skew: 0, showHead: false } satisfies NoteState);
      target.x = positionX;
      target.y = distance * speed * side;
      target.tail = (endFloor - state.floor + offset) * speed * side;
      target.size = note.size ?? 1;
      target.alpha = (note.alpha ?? 255) / 255;
      target.skew = 0;
      target.showHead = true;
      return target;
    }
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
    target.tail = (endFloor - state.floor + offset) * speed * side;
    target.size =
      (note.size ?? 1) * (isHold || !this.hasSizeControl ? 1 : this.controls.size.value(distance));
    target.alpha =
      noteAlpha(note) * (this.hasAlphaControl ? this.controls.alpha.value(distance) : 1);
    target.skew =
      isHold || !this.hasSkewControl ? 0 : positionX * this.controls.skew.value(distance);
    // Match the gameplay renderer: the head disappears once the Hold arrives.
    // A future zero-length Hold still paints both caps before its start time.
    target.showHead = !activeHold;
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

/** Compose one line's local state under its parent's world transform. */
function composeParentState(
  parent: SampledLineState,
  child: SampledLineState,
  line: JudgeLine,
): void {
  // Most exported charts use parent links for grouping while the parent stays at
  // the origin. Avoid two trigonometric calls and the full rotation matrix for
  // that common case; the exact zero check preserves the general path for every
  // genuinely rotated parent.
  if (parent.rotation === 0) {
    if (parent.x !== 0) {
      child.x += parent.x;
    }
    if (parent.y !== 0) {
      child.y += parent.y;
    }
    return;
  }
  const angle = (-parent.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const localX = child.x;
  const localY = child.y;
  child.x = parent.x + localX * cosine - localY * sine;
  child.y = parent.y + localX * sine + localY * cosine;
  child.rotation += inheritsParentRotation(line) ? parent.rotation : 0;
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

/**
 * Build a parent-before-child order for the frame sampler.
 *
 * `null` means the chart contains a parent cycle and must use the defensive
 * recursive sampler. Invalid out-of-range parents are treated as roots, which
 * matches the sampler's existing behavior for malformed but loadable charts.
 */
function parentSampleOrder(lines: readonly JudgeLine[]): number[] | null {
  const children = Array.from({ length: lines.length }, () => [] as number[]);
  const pendingParents = new Uint32Array(lines.length);
  let hasParent = false;
  for (let index = 0; index < lines.length; index += 1) {
    const parent = lineParentIndex(lines[index]?.father);
    if (!Number.isInteger(parent) || parent < 0 || parent >= lines.length) {
      continue;
    }
    hasParent = true;
    if (parent === index) {
      return null;
    }
    pendingParents[index] = 1;
    children[parent].push(index);
  }
  if (!hasParent) {
    return [];
  }
  const queue: number[] = [];
  for (let index = 0; index < pendingParents.length; index += 1) {
    if (pendingParents[index] === 0) {
      queue.push(index);
    }
  }
  const order: number[] = [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    order.push(index);
    for (const child of children[index]) {
      pendingParents[child] = 0;
      queue.push(child);
    }
  }
  return order.length === lines.length ? order : null;
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

/** Return changed source indexes when a note edit preserves visibility broad phases. */
function reusableNoteChanges(runtime: LineRuntime, line: JudgeLine): number[] | null {
  const previous = runtime.line.notes ?? [];
  const next = line.notes ?? [];
  if (previous.length !== next.length) {
    return null;
  }
  const changes: number[] = [];
  for (let index = 0; index < previous.length; index += 1) {
    const before = previous[index];
    const after = next[index];
    if (!before || !after) {
      return null;
    }
    if (
      before.startTime !== after.startTime ||
      before.endTime !== after.endTime ||
      (before.yOffset ?? 0) !== (after.yOffset ?? 0) ||
      (before.speed ?? 1) !== (after.speed ?? 1) ||
      (before.visibleTime ?? 999999) !== (after.visibleTime ?? 999999) ||
      before.type !== after.type
    ) {
      return null;
    }
    if (before !== after) {
      changes.push(index);
    }
  }
  return changes;
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
  /** Render-order subset containing lines with notes for visibility and note passes. */
  declare noteOrder: number[];
  declare orderLines: JudgeLine[];
  declare orderValues: Float64Array;
  declare sortedOrder: number[];
  declare defaultLineColor: number[];
  /** True when every rendered line's world state is time-invariant. */
  declare allStatesStatic: boolean;
  /** World-state staticness after parent transforms have been propagated. */
  private worldStateStatic = new Uint8Array();
  private sampleStatus = new Uint8Array();
  private sampledSeconds = Number.NaN;
  private sampledTempo: TempoSource | null = null;
  private sampledIncludeFloorForEmptyLines = true;
  private sampledStates: SampledLineState[] | null = null;
  /** Local states stay separate from world states because parent composition mutates the latter. */
  private localStates: Array<SampledLineState | undefined> = [];
  /** Parent-composed states keyed by line index; entries are valid only for these exact inputs. */
  private worldStateCache: Array<WorldStateCacheEntry | undefined> = [];
  /** Monotonic input/output versions avoid mistaking an in-place state update for reuse. */
  private localStateVersions = new Uint32Array();
  private worldStateVersions = new Uint32Array();
  private lineSamples = new WeakMap<
    LineRuntime,
    { seconds: number; state: SampledLineState; includeFloorForEmptyLines: boolean }
  >();
  /** Parent-before-child order used by the allocation-free frame sampler. */
  private parentOrder: number[] | null = null;
  /** Lines whose world state must be recomputed after the first sampled frame. */
  private dynamicSampleOrder: number[] = [];
  /** Parentless charts can sample each line without recursive resolution. */
  private hasParentLines = false;
  private runtimeById = new Map<string, LineRuntime>();
  /** Counters exposed to the preview timing sample without allocating per frame. */
  readonly lastSampleStats: SceneSampleStats = emptySceneSampleStats();

  /** Return whether a line's world transform is time-invariant, including its parent chain. */
  isWorldStateStatic(index: number): boolean {
    return this.worldStateStatic[index] === 1;
  }

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
    this.noteOrder = [];
    this.orderLines = [];
    this.orderValues = new Float64Array();
    this.sortedOrder = [];
    this.allStatesStatic = false;
    this.worldStateStatic = new Uint8Array();
    this.sampleStatus = new Uint8Array();
    this.sampledSeconds = Number.NaN;
    this.sampledTempo = null;
    this.sampledIncludeFloorForEmptyLines = true;
    this.sampledStates = null;
    this.localStates = [];
    this.worldStateCache = [];
    this.localStateVersions = new Uint32Array();
    this.worldStateVersions = new Uint32Array();
    this.lineSamples = new WeakMap();
    this.parentOrder = null;
    this.dynamicSampleOrder = [];
    this.hasParentLines = false;
    this.runtimeById.clear();
    this.lastSampleStats.sampledLineCount = 0;
    this.lastSampleStats.staticLineCacheHits = 0;
    this.lastSampleStats.continuousLineCount = 0;
    this.lastSampleStats.parentComposeCount = 0;
    this.lastSampleStats.stateCopyCount = 0;
  }

  /** Compile `chart`, reusing or incrementally updating line runtimes where possible. */
  compile(
    chart: Chart,
    tempo: TempoSource,
    defaultLineColor: readonly number[] = this.defaultLineColor,
    changedLineIndexes?: readonly number[],
    noteChangeHints?: readonly NoteChangeHint[],
  ): void {
    const nextColor = normalizedColor(defaultLineColor);
    const colorChanged = !colorsEqual(this.defaultLineColor, nextColor);
    if (this.chart === chart && this.tempo === tempo && !colorChanged) {
      return;
    }
    const tempoChanged = this.tempo !== tempo;
    const previousChart = this.chart;
    if (tempoChanged || colorChanged) {
      this.cache = new WeakMap();
      this.runtimeById.clear();
      this.tempo = tempo;
    }
    this.defaultLineColor = nextColor;
    this.chart = chart;
    this.sampledSeconds = Number.NaN;
    this.sampledStates = null;
    const sourceLines = chart.judgeLineList ?? [];
    this.hasParentLines = sourceLines.some((line) => {
      const parent = lineParentIndex(line.father);
      return Number.isInteger(parent) && parent >= 0;
    });
    const previousById = this.runtimeById;
    const noteHintsByLine = new Map(
      (noteChangeHints ?? []).map((hint) => [hint.lineIndex, hint] as const),
    );
    const canPatch =
      !tempoChanged &&
      !colorChanged &&
      changedLineIndexes !== undefined &&
      previousChart !== null &&
      sourceLines.length === (previousChart.judgeLineList ?? []).length &&
      this.lines.length === sourceLines.length &&
      changedLineIndexes.every((index) => index >= 0 && index < sourceLines.length);
    const compileLine = (
      line: (typeof sourceLines)[number],
      noteHint?: NoteChangeHint,
    ): LineRuntime | undefined => {
      if (isPlaceholderLine(line)) {
        return undefined;
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
            runtime = previous.withLine(line, noteHint);
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
    };
    if (canPatch) {
      this.runtimeById = new Map(previousById);
      const previousLines = previousChart.judgeLineList ?? [];
      for (const index of changedLineIndexes) {
        const previousLine = previousLines[index];
        const nextLine = sourceLines[index];
        if (previousLine && previousLine !== nextLine) {
          this.cache.delete(previousLine);
          if (typeof previousLine.id === "string" && previousLine.id !== nextLine?.id) {
            this.runtimeById.delete(previousLine.id);
          }
        }
        this.lines[index] = compileLine(
          nextLine,
          noteHintsByLine.get(index),
        ) as unknown as LineRuntime;
      }
    } else {
      this.runtimeById = new Map();
      this.lines = sourceLines.map(
        (line, index) => compileLine(line, noteHintsByLine.get(index)) as unknown as LineRuntime,
      );
    }
    this.allStatesStatic = this.lines.every((runtime) => !runtime || runtime.staticState);
    if (canPatch && this.localStates.length === this.lines.length) {
      // A copy-on-write edit replaces only the listed line runtimes. Keep the
      // reusable local state objects for every untouched line; dropping the
      // whole array makes the next frame allocate one state per dynamic line
      // and turns a one-note CRUD edit into a GC-sized playback hitch.
      for (const index of changedLineIndexes) {
        this.localStates[index] = undefined;
      }
    } else {
      this.localStates = new Array(this.lines.length);
    }
    // A line patch can change an ancestor, inheritance mode, or local transform. The
    // identity checks below make frame reuse safe, while this reset prevents a stale
    // world object from surviving a chart topology change.
    this.worldStateCache = new Array(this.lines.length);
    this.localStateVersions = new Uint32Array(this.lines.length);
    this.worldStateVersions = new Uint32Array(this.lines.length);
    const parentOrder = parentSampleOrder(sourceLines);
    this.parentOrder = parentOrder;
    this.worldStateStatic = new Uint8Array(this.lines.length);
    const staticOrder = parentOrder ?? sourceLines.map((unused, index) => index);
    for (const index of staticOrder) {
      const runtime = this.lines[index];
      if (!runtime) {
        this.worldStateStatic[index] = 1;
        continue;
      }
      const parent = lineParentIndex(runtime.line.father);
      this.worldStateStatic[index] =
        runtime.staticState &&
        (!Number.isInteger(parent) ||
          parent < 0 ||
          parent >= this.lines.length ||
          this.worldStateStatic[parent] === 1)
          ? 1
          : 0;
    }
    this.dynamicSampleOrder =
      this.hasParentLines && parentOrder
        ? parentOrder.filter((index) => this.worldStateStatic[index] !== 1)
        : sourceLines
            .map((unused, index) => index)
            .filter((index) => this.worldStateStatic[index] !== 1);
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
    this.noteOrder = this.order.filter((index) => (this.lines[index]?.notes.length ?? 0) > 0);
  }

  /**
   * Sample one line into reusable storage.
   *
   * The cached local state is reused when it belongs to the requested time or
   * the line is time-invariant, so a static line costs one copy per frame.
   */
  private sampledLineState(
    runtime: LineRuntime,
    seconds: number,
    slot: SampledLineState | undefined,
    includeFloorForEmptyLines: boolean,
  ): SampledLineState {
    const cached = this.lineSamples.get(runtime);
    if (
      cached &&
      (cached.seconds === seconds || runtime.staticState) &&
      cached.includeFloorForEmptyLines === includeFloorForEmptyLines
    ) {
      return copyLineState(slot, cached.state);
    }
    const localState = runtime.state(seconds, cached?.state, includeFloorForEmptyLines);
    const state = copyLineState(slot, localState);
    if (cached) {
      cached.seconds = seconds;
      cached.includeFloorForEmptyLines = includeFloorForEmptyLines;
    } else {
      this.lineSamples.set(runtime, {
        seconds,
        state: localState,
        includeFloorForEmptyLines,
      });
    }
    return state;
  }

  /** Sample a topologically ordered line into its reusable local state. */
  private sampledLocalState(
    index: number,
    runtime: LineRuntime,
    seconds: number,
    includeFloorForEmptyLines: boolean,
  ): SampledLineState {
    const cached =
      this.localStates[index] ??
      (runtime.staticState ? this.lineSamples.get(runtime)?.state : undefined);
    if (cached && runtime.staticState) {
      this.localStates[index] = cached;
      return cached;
    }
    const local = runtime.state(seconds, cached, includeFloorForEmptyLines);
    this.localStates[index] = local;
    // The defensive sampler still needs a static local cache, while the
    // topological path itself stays indexed and does not touch a WeakMap for
    // dynamic lines on every playback frame.
    if (runtime.staticState && !this.lineSamples.has(runtime)) {
      this.lineSamples.set(runtime, {
        seconds,
        state: local,
        includeFloorForEmptyLines,
      });
    }
    return local;
  }

  /**
   * Return a sampler resolving one line's world state at `seconds`.
   *
   * Parent transforms are resolved lazily and cached per sample time. Preview may disable
   * floor sampling for lines without notes because that value is not consumed by drawing.
   */
  sampler(
    seconds: number,
    states: SampledLineState[] = [],
    status = new Uint8Array(this.lines.length),
    includeFloorForEmptyLines = true,
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
      states[index] = this.sampledLineState(
        runtime,
        seconds,
        states[index],
        includeFloorForEmptyLines,
      );
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
        composeParentState(ancestor, local, line);
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

  /**
   * Sample into caller-owned storage so frame renderers can avoid array churn.
   *
   * `includeFloorForEmptyLines` keeps the full runtime contract by default; preview passes
   * `false` because empty structural lines never query floor distance.
   */
  sampleInto(
    seconds: number,
    target: SampledLineState[],
    includeFloorForEmptyLines = true,
  ): SampledLineState[] {
    this.lastSampleStats.sampledLineCount = 0;
    this.lastSampleStats.staticLineCacheHits = 0;
    this.lastSampleStats.continuousLineCount = 0;
    this.lastSampleStats.parentComposeCount = 0;
    this.lastSampleStats.stateCopyCount = 0;
    if (
      this.sampledStates &&
      this.sampledSeconds === seconds &&
      this.sampledTempo === this.tempo &&
      this.sampledIncludeFloorForEmptyLines === includeFloorForEmptyLines
    ) {
      if (target === this.sampledStates) {
        return target;
      }
      target.length = this.sampledStates.length;
      for (let index = 0; index < this.sampledStates.length; index += 1) {
        target[index] = this.sampledStates[index];
      }
      return target;
    }
    if (!this.hasParentLines) {
      target.length = this.lines.length;
      const previous = this.sampledStates;
      const reuseStaticStates = previous === target && previous.length === this.lines.length;
      const indexes = reuseStaticStates
        ? this.dynamicSampleOrder
        : Array.from({ length: this.lines.length }, (unused, index) => index);
      for (const index of indexes) {
        const runtime = this.lines[index];
        if (runtime?.staticState && previous?.[index]) {
          this.lastSampleStats.staticLineCacheHits += 1;
          target[index] = previous[index];
        } else if (runtime) {
          this.lastSampleStats.sampledLineCount += 1;
          this.lastSampleStats.continuousLineCount += 1;
          target[index] = runtime.state(seconds, target[index], includeFloorForEmptyLines);
        } else {
          target[index] = emptyLineState();
        }
      }
      this.sampledSeconds = seconds;
      this.sampledTempo = this.tempo;
      this.sampledIncludeFloorForEmptyLines = includeFloorForEmptyLines;
      this.sampledStates = target;
      return target;
    }
    if (this.parentOrder !== null) {
      target.length = this.lines.length;
      const previous = this.sampledStates;
      const reuseStaticStates = previous === target && previous.length === this.lines.length;
      const indexes = reuseStaticStates ? this.dynamicSampleOrder : this.parentOrder;
      for (const index of indexes) {
        const runtime = this.lines[index];
        if (!runtime) {
          target[index] = emptyLineState();
          continue;
        }
        // A static local line under a static parent has a stable world state too.
        // Reuse the complete sampled object instead of resolving its local tracks and
        // entering the parent composition path on every playback frame.
        if (this.worldStateStatic[index] === 1 && previous?.[index]) {
          this.lastSampleStats.staticLineCacheHits += 1;
          target[index] = previous[index];
          continue;
        }
        this.lastSampleStats.sampledLineCount += 1;
        this.lastSampleStats.continuousLineCount += 1;
        const local = this.sampledLocalState(index, runtime, seconds, includeFloorForEmptyLines);
        if (!runtime.staticState) {
          this.localStateVersions[index] = (this.localStateVersions[index] + 1) >>> 0;
        }
        this.localStates[index] = local;
        const parent = lineParentIndex(runtime.line.father);
        if (!Number.isInteger(parent) || parent < 0 || parent >= this.lines.length) {
          // A root has no world-space composition to apply. Reusing its local state avoids
          // copying every field into a second object on every playback frame.
          const wasComposed = this.worldStateCache[index] !== undefined;
          if (wasComposed) {
            this.worldStateVersions[index] = (this.worldStateVersions[index] + 1) >>> 0;
          } else {
            this.worldStateVersions[index] = this.localStateVersions[index];
          }
          this.worldStateCache[index] = undefined;
          target[index] = local;
        } else {
          const ancestor = target[parent];
          const parentVersion = this.worldStateVersions[parent];
          // Most parent links are structural: the parent remains at the origin
          // and carries no rotation. In that case the child's local state is
          // already its world state, so avoid copying every field before the
          // no-op composition. Preserve the full copy path for translated or
          // rotated parents, where the local object must stay reusable.
          if (ancestor && ancestor.x === 0 && ancestor.y === 0 && ancestor.rotation === 0) {
            const wasComposed = this.worldStateCache[index] !== undefined;
            if (wasComposed) {
              this.worldStateVersions[index] = (this.worldStateVersions[index] + 1) >>> 0;
            } else {
              this.worldStateVersions[index] = this.localStateVersions[index];
            }
            this.worldStateCache[index] = undefined;
            target[index] = local;
          } else {
            const cachedWorld = this.worldStateCache[index];
            if (
              cachedWorld?.localVersion === this.localStateVersions[index] &&
              cachedWorld.parentVersion === parentVersion
            ) {
              target[index] = cachedWorld.state;
              continue;
            }
            // A prior frame may have aliased this slot to `local` through the
            // identity fast path. Never compose into that local cache when a
            // parent starts moving; allocate a separate world-state object.
            const world = copyLineState(target[index] === local ? undefined : target[index], local);
            this.lastSampleStats.stateCopyCount += 1;
            if (ancestor && world) {
              composeParentState(ancestor, world, runtime.line);
              this.lastSampleStats.parentComposeCount += 1;
            }
            if (ancestor && world) {
              this.worldStateCache[index] = {
                localVersion: this.localStateVersions[index],
                parentVersion,
                state: world,
              };
              this.worldStateVersions[index] = (this.worldStateVersions[index] + 1) >>> 0;
            }
            target[index] = world;
          }
        }
      }
      this.sampledSeconds = seconds;
      this.sampledTempo = this.tempo;
      this.sampledIncludeFloorForEmptyLines = includeFloorForEmptyLines;
      this.sampledStates = target;
      return target;
    }
    if (this.sampleStatus.length !== this.lines.length) {
      this.sampleStatus = new Uint8Array(this.lines.length);
    } else {
      this.sampleStatus.fill(0);
    }
    const sample = this.sampler(seconds, target, this.sampleStatus, includeFloorForEmptyLines);
    for (let index = 0; index < this.lines.length; index++) {
      if (!this.lines[index]) {
        target[index] = emptyLineState();
        continue;
      }
      sample(index);
    }
    this.sampledSeconds = seconds;
    this.sampledTempo = this.tempo;
    this.sampledIncludeFloorForEmptyLines = includeFloorForEmptyLines;
    this.sampledStates = target;
    return target;
  }
}
