/**
 * Models editor-only noise-line settings and projects them to RPE noise areas.
 *
 * A noise line owns a unit square centred on its transform origin. Its
 * `scaleXEvents`/`scaleYEvents` tracks carry the square's width and height
 * (size X/Y), not a multiplier: a missing or zero size hides the area. The unit
 * square makes the editor value and the RPE `scale` multiplier numerically
 * identical, so the projection never mixes the two interpretations.
 */
import {
  inheritsParentRotation,
  type Chart,
  type JudgeLine,
  type JudgeLineEvent,
} from "../chart.ts";
import type { BlockArea, BlockAreaInterval } from "./blockArea.ts";
import { clearLineNoiseConflicts, lineNoiseConflicts } from "./lineNoiseConflicts.ts";
import { beatCopy, beatValue, isBeat, type Beat } from "../timing/beat.ts";
import { TempoMap } from "../timing/tempo.ts";
import { offsetNoiseTrack, staticNoiseParent } from "./staticNoiseParent.ts";
import { composeLinearNoiseTracks } from "./linearNoiseTracks.ts";
import { bakeNoiseLine } from "./bakeNoiseLine.ts";
import { noiseParentIndex } from "./noiseParent.ts";

/** Stored separately from PEZ chart data by the editor's library adapter. */
export interface NoiseLineSettings {
  readonly version: 2;
  readonly invert: boolean;
  readonly area: Pick<
    BlockArea,
    "bottomLeft" | "topRight" | "appearTime" | "disappearTime" | "activeIntervals"
  >;
}

/** Editor-only field, removed by export projection. */
export const NOISE_LINE_FIELD = "_reduxNoiseLine";

/** Half extent of the editor's unit-square noise template. */
const NOISE_LINE_HALF_EXTENT = 0.5;

/** Editor noise lines always use this rectangle; size lives in the scale tracks. */
function noiseLineBounds(): Pick<BlockArea, "bottomLeft" | "topRight"> {
  return {
    bottomLeft: { x: -NOISE_LINE_HALF_EXTENT, y: -NOISE_LINE_HALF_EXTENT },
    topRight: { x: NOISE_LINE_HALF_EXTENT, y: NOISE_LINE_HALF_EXTENT },
  };
}

type NoiseLine = JudgeLine & { _reduxNoiseLine?: NoiseLineSettings };

const normalizedSettings = new WeakMap<object, NoiseLineSettings | null>();

/** Copy an activation interval with its own beat tuples. */
function cloneInterval(interval: BlockAreaInterval): BlockAreaInterval {
  return {
    ...interval,
    startTime: [...interval.startTime],
    endTime: [...interval.endTime],
  };
}

/** A ready flash is an omitted default, a boolean, or a non-negative lead time. */
function validReadyFlash(value: BlockAreaInterval["readyFlash"]): boolean {
  return (
    value === undefined ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

/** True when an activation interval has valid ordered beats and a usable flash lead. */
function validInterval(interval: BlockAreaInterval | undefined): interval is BlockAreaInterval {
  return Boolean(
    interval &&
    isBeat(interval.startTime) &&
    isBeat(interval.endTime) &&
    beatValue(interval.endTime) >= beatValue(interval.startTime) &&
    validReadyFlash(interval.readyFlash),
  );
}

/** Validate version 2 settings, returning null for any other shape. */
function normalizeNoiseLineSettings(raw: NoiseLineSettings | undefined): NoiseLineSettings | null {
  if (
    !raw ||
    typeof raw !== "object" ||
    raw.version !== 2 ||
    typeof raw.invert !== "boolean" ||
    !raw.area
  ) {
    return null;
  }
  const area = raw.area;
  const bounds = noiseLineBounds();
  if (
    !area.bottomLeft ||
    !area.topRight ||
    area.bottomLeft.x !== bounds.bottomLeft.x ||
    area.bottomLeft.y !== bounds.bottomLeft.y ||
    area.topRight.x !== bounds.topRight.x ||
    area.topRight.y !== bounds.topRight.y ||
    !isBeat(area.appearTime) ||
    !isBeat(area.disappearTime) ||
    beatValue(area.disappearTime) < beatValue(area.appearTime) ||
    !Array.isArray(area.activeIntervals) ||
    area.activeIntervals.some((interval) => !validInterval(interval))
  ) {
    return null;
  }
  return {
    version: 2,
    invert: raw.invert,
    area: {
      ...bounds,
      appearTime: [...area.appearTime],
      disappearTime: [...area.disappearTime],
      activeIntervals: area.activeIntervals.map(cloneInterval),
    },
  };
}

/** Keep exported activation canonical: drop empty intervals and merge overlaps. */
function mergeActiveIntervals(intervals: readonly BlockAreaInterval[]): BlockAreaInterval[] {
  const sorted = intervals
    .filter((interval) => beatValue(interval.endTime) > beatValue(interval.startTime))
    .sort((left, right) => beatValue(left.startTime) - beatValue(right.startTime));
  const merged: BlockAreaInterval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && beatValue(interval.startTime) < beatValue(previous.endTime)) {
      if (beatValue(interval.endTime) > beatValue(previous.endTime)) {
        merged[merged.length - 1] = { ...previous, endTime: interval.endTime };
      }
      continue;
    }
    merged.push({ ...interval });
  }
  return merged;
}

/** Fields that must match before aligned layer values can be summed exactly. */
function eventSignature(event: JudgeLineEvent): string {
  return JSON.stringify([
    event.startTime,
    event.endTime,
    event.easingType ?? 1,
    event.easingLeft ?? 0,
    event.easingRight ?? 1,
    Boolean(event.bezier),
    event.bezierPoints ?? [],
    Boolean(event.inst),
  ]);
}

/** Add aligned layer tracks exactly; unmatched easing cannot be flattened losslessly. */
function composeAlignedTracks(
  tracks: JudgeLineEvent[][],
  tempo: TempoMap | undefined,
  appear: Beat,
): JudgeLineEvent[] {
  if (tracks.length <= 1) {
    return tracks[0] ?? [];
  }
  const reference = tracks[0];
  const aligned = tracks.every(
    (track) =>
      track.length === reference.length &&
      track.every((event, index) => eventSignature(event) === eventSignature(reference[index])),
  );
  if (!aligned) {
    const linear = composeLinearNoiseTracks(tracks, tempo, appear);
    if (linear) {
      return linear;
    }
    throw new Error("noise line requires multilayer transform conversion");
  }
  return reference.map((event, index) => {
    const peers = tracks.map((track) => track[index]);
    if (
      peers.some(
        (item) =>
          item.trajectory ||
          typeof item.start !== "number" ||
          typeof item.end !== "number" ||
          !Number.isFinite(item.start) ||
          !Number.isFinite(item.end) ||
          eventSignature(item) !== eventSignature(event) ||
          "transformStart" in item ||
          "transformEnd" in item ||
          "anchor" in item,
      )
    ) {
      throw new Error("noise line requires multilayer transform conversion");
    }
    return {
      ...event,
      start: peers.reduce((sum, item) => sum + Number(item.start), 0),
      end: peers.reduce((sum, item) => sum + Number(item.end), 0),
    };
  });
}

/** Read validated settings from a line, or null when the field is absent or invalid. */
export function noiseLineSettings(line: JudgeLine | undefined): NoiseLineSettings | null {
  const raw = (line as NoiseLine | undefined)?._reduxNoiseLine;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  if (normalizedSettings.has(raw)) {
    return normalizedSettings.get(raw) ?? null;
  }
  const settings = normalizeNoiseLineSettings(raw);
  normalizedSettings.set(raw, settings);
  return settings;
}

/** True for any stored version except invalid version 2 settings. */
export function validNoiseLineSettings(line: JudgeLine): boolean {
  const raw = (line as NoiseLine | undefined)?._reduxNoiseLine;
  if (!raw || typeof raw !== "object") {
    return false;
  }
  if ((raw as { version?: unknown }).version !== 2) {
    return true;
  }
  return noiseLineSettings(line) !== null;
}

/** Drop scale tracks when the line changes purpose: their unit differs per mode. */
function withoutScaleTracks(line: JudgeLine): JudgeLine {
  if (!line.extended || (!line.extended.scaleXEvents && !line.extended.scaleYEvents)) {
    return line;
  }
  const extended = { ...line.extended };
  delete extended.scaleXEvents;
  delete extended.scaleYEvents;
  return { ...line, extended };
}

/** Switch a line to normal or inverted noise, or turn noise off. */
export function setNoiseLineMode(
  line: JudgeLine,
  mode: "normal" | "inverted" | "off",
  clearConflicts = false,
): JudgeLine {
  if (mode === "off") {
    if (!noiseLineSettings(line)) {
      return line;
    }
    const next: NoiseLine = { ...line };
    delete next._reduxNoiseLine;
    return withoutScaleTracks(next) as NoiseLine;
  }
  const existing = noiseLineSettings(line);
  const conflicts = lineNoiseConflicts(line);
  if (
    !clearConflicts &&
    (conflicts.notes ||
      conflicts.alphaEvents ||
      conflicts.speedEvents ||
      (!existing && conflicts.textures))
  ) {
    throw new Error("noise line has incompatible content");
  }
  const cleared = clearConflicts ? clearLineNoiseConflicts(line) : line;
  // A standard line's scale tracks describe its hidden texture, not the noise
  // area's size; starting from empty tracks keeps size 0.
  const clean = existing ? cleared : withoutScaleTracks(cleared);
  const appearTime = existing?.area.appearTime ?? [0, 0, 1];
  const disappearTime = existing?.area.disappearTime ?? [1000000, 0, 1];
  const activeIntervals = existing ? existing.area.activeIntervals.map(cloneInterval) : [];
  const settings: NoiseLineSettings = {
    version: 2,
    invert: mode === "inverted",
    area: {
      ...noiseLineBounds(),
      appearTime: [...appearTime],
      disappearTime: [...disappearTime],
      activeIntervals,
    },
  };
  return { ...clean, _reduxNoiseLine: settings } as NoiseLine;
}

/**
 * Return the canonical RPE Next area for one noise line.
 *
 * `blockAreaList` has no judge-line parent relation, so ancestor translation and
 * rotation are flattened into the area's own tracks. Simple static or linear
 * ancestors project exactly; `projectNoiseLinesForExport` samples complex
 * ancestor chains through the scene runtime. Anchors are ignored because they
 * only offset the hidden line texture around the same transform origin the
 * world-space area is centered on.
 */
export function noiseAreaForLine(
  line: JudgeLine,
  tempo?: TempoMap,
  chart?: Chart,
): BlockArea | null {
  const settings = noiseLineSettings(line);
  if (!settings) {
    return null;
  }
  if (!validNoiseLineSettings(line)) {
    throw new Error("invalid editor noise line settings");
  }
  const conflicts = lineNoiseConflicts(line);
  if (conflicts.notes || conflicts.alphaEvents || conflicts.speedEvents) {
    throw new Error("noise line has incompatible notes or events");
  }
  // The line's anchor only offsets its own hidden texture around the transform
  // origin. A noise area is a world-space rectangle centered on that same
  // origin, so the anchor does not change the area's transform tracks.
  for (const events of [line.extended?.scaleXEvents, line.extended?.scaleYEvents]) {
    if (events?.some((event) => event.trajectory)) {
      throw new Error("noise line requires size trajectory conversion");
    }
  }
  const layers = (line.eventLayers ?? []).slice(0, 5);
  const movement = ["moveXEvents", "moveYEvents", "rotateEvents"] as const;
  for (const layer of layers) {
    for (const type of movement) {
      const events = layer?.[type];
      if (
        events?.length &&
        Math.min(...events.map((event) => beatValue(event.startTime))) >
          beatValue(settings.area.appearTime)
      ) {
        throw new Error("noise line requires movement prelude conversion");
      }
    }
  }
  const hasParent = noiseParentIndex(line.father) !== -1;
  if (hasParent && (!chart || !tempo)) {
    throw new Error("noise line requires its parent chart and tempo map");
  }
  const parent = hasParent ? staticNoiseParent(chart!, line, tempo!) : null;
  // Trajectory move events also produce Y and rotation, so copying X alone would lose them.
  if (layers.some((layer) => layer?.moveXEvents?.some((event) => event.trajectory))) {
    throw new Error("noise line requires trajectory transform conversion");
  }
  const eventsFor = (type: (typeof movement)[number]) =>
    composeAlignedTracks(
      layers.flatMap((layer) => (layer?.[type]?.length ? [layer[type]!] : [])),
      tempo,
      settings.area.appearTime,
    );
  let xEvents = eventsFor("moveXEvents");
  let yEvents = eventsFor("moveYEvents");
  let rotateEvents = eventsFor("rotateEvents");
  if (parent) {
    const centerX = (settings.area.bottomLeft.x + settings.area.topRight.x) / 2;
    const centerY = (settings.area.bottomLeft.y + settings.area.topRight.y) / 2;
    if (centerX !== 0 || centerY !== 0) {
      throw new Error("noise parent requires centered bounds");
    }
    if (
      [xEvents, yEvents, rotateEvents].some(
        (track) =>
          track.length > 0 && beatValue(track[0].startTime) > beatValue(settings.area.appearTime),
      )
    ) {
      throw new Error("noise parent requires transform composition");
    }
    for (const event of [...xEvents, ...yEvents, ...rotateEvents]) {
      if (
        "transformStart" in event ||
        "transformEnd" in event ||
        "anchor" in event ||
        "transformStep" in event ||
        event.trajectory
      ) {
        throw new Error("noise parent requires transform composition");
      }
    }
    const start = settings.area.appearTime;
    const angle = (-parent.rotation * Math.PI) / 180;
    const c = Math.abs(Math.cos(angle)) < 1e-12 ? 0 : Math.cos(angle);
    const s = Math.abs(Math.sin(angle)) < 1e-12 ? 0 : Math.sin(angle);
    const x = xEvents;
    const y = yEvents;
    const projectAxis = (
      xWeight: number,
      yWeight: number,
      translation: number,
      axis: "xWeight" | "yWeight",
    ) => {
      const dynamic: JudgeLineEvent[][] = [];
      let offset = translation;
      const components: Array<readonly [JudgeLineEvent[], number]> = [
        [x, xWeight],
        [y, yWeight],
        ...parent.translations.map((track) => [track.events, track[axis]] as const),
      ];
      for (const [events, weight] of components) {
        if (!weight || !events.length) {
          continue;
        }
        const value = events[0].start;
        if (
          typeof value === "number" &&
          events.every((event) => event.start === value && event.end === value)
        ) {
          offset += value * weight;
        } else {
          if (
            events.some((event) => beatValue(event.startTime) < beatValue(events[0].startTime)) ||
            beatValue(events[0].startTime) > beatValue(start)
          ) {
            throw new Error("noise parent requires transform composition");
          }
          dynamic.push(offsetNoiseTrack(events, weight, 0, start));
        }
      }
      return offsetNoiseTrack(composeAlignedTracks(dynamic, tempo, start), 1, offset, start);
    };
    xEvents = projectAxis(c, -s, parent.x, "xWeight");
    yEvents = projectAxis(s, c, parent.y, "yWeight");
    const inheritsRotation = inheritsParentRotation(line);
    if (inheritsRotation && parent.rotations.length) {
      const dynamic: JudgeLineEvent[][] = [];
      let offset = parent.rotation;
      for (const events of [rotateEvents, ...parent.rotations]) {
        if (!events.length) {
          continue;
        }
        const value = events[0].start;
        if (
          typeof value === "number" &&
          events.every((event) => event.start === value && event.end === value)
        ) {
          offset += value;
        } else {
          if (
            events.some((event) => beatValue(event.startTime) < beatValue(events[0].startTime)) ||
            beatValue(events[0].startTime) > beatValue(start)
          ) {
            throw new Error("noise parent requires transform composition");
          }
          dynamic.push(events);
        }
      }
      rotateEvents = offsetNoiseTrack(
        composeAlignedTracks(dynamic, tempo, start),
        1,
        offset,
        start,
      );
    } else {
      rotateEvents = offsetNoiseTrack(
        rotateEvents,
        1,
        inheritsRotation ? parent.rotation : 0,
        start,
      );
    }
  }
  // Notes, events and shader effects all use the chart's global BPM grid, so a
  // line's authored beats need no rescaling here. `bpmfactor` only changes the
  // Hold hit-effect pulse rate and leaves every copied event beat untouched.
  const copy = (events: readonly JudgeLineEvent[] | undefined) =>
    (events ?? []).map((event) => ({
      ...structuredClone(event),
      startTime: beatCopy(event.startTime as Beat),
      endTime: beatCopy(event.endTime as Beat),
    }));
  const zeroSize = (start: Beat, end: Beat): JudgeLineEvent => ({
    startTime: beatCopy(start),
    endTime: beatCopy(end),
    start: 0,
    end: 0,
    easingType: 1,
  });
  const sizeTrack = (events: readonly JudgeLineEvent[] | undefined): JudgeLineEvent[] => {
    const copied = copy(events);
    if (!copied.length) {
      return [zeroSize(beatCopy(settings.area.appearTime), beatCopy(settings.area.disappearTime))];
    }
    const ordered = [...copied].sort(
      (left, right) => beatValue(left.startTime) - beatValue(right.startTime),
    );
    const first = ordered[0];
    const appear = beatCopy(settings.area.appearTime);
    // Empty size means hidden. RPE's own fallback is 1x1, so a late first size
    // event needs an explicit zero span before it.
    return beatValue(first.startTime) > beatValue(appear)
      ? [zeroSize(appear, beatCopy(first.startTime as Beat)), ...ordered]
      : ordered;
  };
  // The unit square makes the editor's size value and the exported RPE scale
  // multiplier the same number; no base conversion happens here.
  const sizeX = sizeTrack(line.extended?.scaleXEvents);
  const sizeY = sizeTrack(line.extended?.scaleYEvents);
  return {
    ...structuredClone(settings.area),
    appearTime: beatCopy(settings.area.appearTime),
    disappearTime: beatCopy(settings.area.disappearTime),
    activeIntervals: mergeActiveIntervals(
      settings.area.activeIntervals.map((interval) => ({
        ...interval,
        startTime: beatCopy(interval.startTime),
        endTime: beatCopy(interval.endTime),
      })),
    ),
    Name: line.Name ?? "",
    isInvert: settings.invert,
    moveXEvents: copy(xEvents),
    moveYEvents: copy(yEvents),
    rotateEvents: copy(rotateEvents),
    scaleXEvents: sizeX,
    scaleYEvents: sizeY,
  };
}

/** Whether the field carries current version 2 settings. */
function currentNoiseField(line: JudgeLine): boolean {
  const raw = (line as Record<string, unknown>)[NOISE_LINE_FIELD];
  return Boolean(raw && typeof raw === "object" && (raw as { version?: unknown }).version === 2);
}

/** Build an external chart without leaking editor-only noise-line settings. */
export function projectNoiseLinesForExport(chart: Chart): Chart {
  const areas = [...(chart.blockAreaList ?? [])];
  const tempo = new TempoMap(chart.BPMList);
  let found = false;
  const lines = chart.judgeLineList?.map((line, index) => {
    let area: BlockArea | null;
    try {
      area = noiseAreaForLine(line, tempo, chart);
    } catch (error) {
      if (!validNoiseLineSettings(line)) {
        throw error;
      }
      const conflicts = lineNoiseConflicts(line);
      if (conflicts.notes || conflicts.alphaEvents || conflicts.speedEvents) {
        throw error;
      }
      const template = noiseAreaForLine(
        { ...line, father: -1, eventLayers: [], extended: {} },
        tempo,
      );
      if (!template) {
        throw error;
      }
      area = bakeNoiseLine(chart, index, tempo, template);
    }
    if (!area) {
      if (!Object.hasOwn(line, NOISE_LINE_FIELD)) {
        return line;
      }
      if (currentNoiseField(line)) {
        throw new Error("invalid editor noise line settings");
      }
      // An unknown settings version is stripped and the line exports as ordinary data.
      const external: NoiseLine = { ...line };
      delete external._reduxNoiseLine;
      found = true;
      return external;
    }
    found = true;
    areas.push(area);
    const external: NoiseLine = { ...line };
    delete external._reduxNoiseLine;
    // Preserve the line's index and parent relationships without drawing an
    // ordinary judge line in players that understand the exported noise area.
    const layers = [...(external.eventLayers ?? [])];
    layers[0] = {
      ...layers[0],
      alphaEvents: [{ startTime: [0, 0, 1], endTime: [1, 0, 1], start: 0, end: 0 }],
    };
    external.eventLayers = layers;
    return external;
  });
  return found
    ? {
        ...chart,
        judgeLineList: lines,
        blockAreaList: areas,
      }
    : chart;
}
