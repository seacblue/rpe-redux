/** Resolves time-aware hit-test requests against chart data without editor state. */
import type { Chart, JudgeLineEvent } from "../../global/chart/chart.ts";
import { EVENT_TYPES } from "../../global/chart/chartVocabulary.ts";
import { beatValue, fromNumber, isBeat, normalizeBeat } from "../../global/chart/timing/beat.ts";
import { EventTrack } from "../../global/chart/timing/events.ts";
import type { TempoMap } from "../../global/chart/timing/tempo.ts";
import { eventListAt, NOISE_ACTIVE_EVENTS, QUERYABLE_EVENT_TRACKS } from "../events/eventTracks.ts";
import type {
  HitTestAtRequest,
  HitTestAtResult,
  HitTestAtOrdering,
  HitTestEventLayer,
  HitTestKind,
  HitTestTime,
  HitTestValue,
} from "./api.ts";

interface QueryOptions {
  chart: Chart;
  tempo: Pick<TempoMap, "beat" | "seconds">;
  request: HitTestAtRequest;
}

/** Default and hard upper bound for one temporal query response. */
export const DEFAULT_HIT_TEST_LIMIT = 100;
export const MAX_HIT_TEST_LIMIT = 1000;

/** Pure query output before the runtime adds chart revision metadata. */
export interface HitTestQueryResult {
  readonly hits: readonly HitTestAtResult[];
  readonly totalHits: number;
  readonly truncated: boolean;
  readonly ordering: HitTestAtOrdering;
}

/** Resolve a seconds-or-beat selector into one canonical chart time. */
function resolveTime(
  input: HitTestAtRequest["time"],
  tempo: Pick<TempoMap, "beat" | "seconds">,
): HitTestTime {
  const hasSeconds = input.seconds !== undefined;
  const hasBeat = input.beat !== undefined;
  if (hasSeconds === hasBeat) {
    throw new RangeError("Hit-test time must contain exactly one of seconds or beat");
  }
  if (hasSeconds) {
    if (!Number.isFinite(input.seconds)) {
      throw new RangeError("Hit-test seconds must be finite");
    }
    const seconds = input.seconds;
    const beat = fromNumber(tempo.beat(seconds));
    return { seconds, beat };
  }
  const rawBeat = input.beat;
  const beat =
    typeof rawBeat === "number"
      ? fromNumber(rawBeat)
      : Array.isArray(rawBeat) && isBeat(rawBeat)
        ? normalizeBeat(rawBeat)
        : null;
  if (!beat) {
    throw new RangeError("Hit-test beat must be a finite number or a valid beat triple");
  }
  return { seconds: tempo.seconds(beat), beat };
}

/** Return whether a chart beat falls inside an object's inclusive time span. */
function activeAt(
  beat: readonly number[],
  start: readonly number[],
  end: readonly number[],
): boolean {
  const value = beatValue(beat);
  return value >= beatValue(start) && value <= beatValue(end);
}

/** Select the requested kinds, defaulting to all chart object categories. */
function includedKinds(request: HitTestAtRequest): Set<HitTestKind> {
  return new Set(request.include ?? ["note", "judgeLine", "event"]);
}

/** Normalize the caller's result bound after public request validation. */
function queryLimit(request: HitTestAtRequest): number {
  return Math.min(request.limit ?? DEFAULT_HIT_TEST_LIMIT, MAX_HIT_TEST_LIMIT);
}

/** Resolve the public layer identity for one event track. */
function eventLayerFor(type: string, layer: number): HitTestEventLayer {
  return type === NOISE_ACTIVE_EVENTS || (EVENT_TYPES as readonly string[]).includes(type)
    ? layer
    : "extended";
}

/** Copy a beat into a detached result field. */
function copiedBeat(value: readonly number[]): readonly [number, number, number] {
  return [value[0], value[1], value[2]];
}

/** Detach an event value while preserving scalar, vector, text, and null forms. */
function copiedValue(value: HitTestValue): HitTestValue {
  return Array.isArray(value) ? [...value] : value;
}

/** Sample one event using the same easing rules as the chart runtime. */
function eventValueAt(
  event: JudgeLineEvent,
  seconds: number,
  tempo: Pick<TempoMap, "seconds">,
  factor: number,
): HitTestValue {
  const start = tempo.seconds(event.startTime, factor);
  const end = tempo.seconds(event.endTime, factor);
  const track = new EventTrack([event], tempo, factor);
  return copiedValue(track.sample({ event, start, end }, seconds));
}

/** Resolve a stable line id and optional display index into chart line indexes. */
function lineIndicesFor(chart: Chart, request: HitTestAtRequest): number[] {
  const lines = chart.judgeLineList ?? [];
  if (request.lineId !== undefined) {
    const matches = lines.flatMap((line, index) => (line.id === request.lineId ? [index] : []));
    return request.lineIndex === undefined
      ? matches
      : matches.includes(request.lineIndex)
        ? [request.lineIndex]
        : [];
  }
  return request.lineIndex === undefined ? lines.map((_, index) => index) : [request.lineIndex];
}

/** Query active chart objects at one time without reading or changing viewport state. */
export function queryChartAtTime({ chart, tempo, request }: QueryOptions): HitTestQueryResult {
  const time = resolveTime(request.time, tempo);
  const include = includedKinds(request);
  const eventLayer = request.eventLayer;
  if (include.has("event") && eventLayer === undefined) {
    throw new RangeError("Hit-test event queries require an explicit event layer");
  }
  const lineIndices = lineIndicesFor(chart, request);
  const results: HitTestAtResult[] = [];
  const limit = queryLimit(request);
  let totalHits = 0;
  const addHit = (hit: HitTestAtResult): void => {
    totalHits += 1;
    if (results.length < limit) {
      results.push(hit);
    }
  };
  const eventTypes = request.eventTypes ? new Set(request.eventTypes) : null;

  for (const lineIndex of lineIndices) {
    const line = chart.judgeLineList?.[lineIndex];
    if (!line) {
      continue;
    }
    const lineId = line.id ?? `line:${lineIndex}`;
    if (include.has("note")) {
      for (const [noteIndex, note] of (line.notes ?? []).entries()) {
        if (!activeAt(time.beat, note.startTime, note.endTime)) {
          continue;
        }
        addHit({
          kind: "note",
          objectId: note.id ?? `line:${lineIndex}:note:${noteIndex}`,
          lineId,
          lineIndex,
          coordinateSpace: request.coordinateSpace ?? "chart-time",
          time,
          noteType: note.type,
          noteIndex,
          startTime: copiedBeat(note.startTime),
          endTime: copiedBeat(note.endTime),
        });
      }
    }
    if (include.has("judgeLine")) {
      addHit({
        kind: "judgeLine",
        objectId: line.id ?? `line:${lineIndex}`,
        lineId,
        lineIndex,
        coordinateSpace: request.coordinateSpace ?? "chart-time",
        time,
      });
    }
    if (include.has("event")) {
      const queryEventLayer = eventLayer as number;
      for (const type of QUERYABLE_EVENT_TRACKS) {
        if (eventTypes && !eventTypes.has(type)) {
          continue;
        }
        const events = eventListAt(
          { chart, lineIndex, eventLayer: queryEventLayer },
          lineIndex,
          type,
          queryEventLayer,
        );
        for (const [eventIndex, event] of events.entries()) {
          if (!activeAt(time.beat, event.startTime, event.endTime)) {
            continue;
          }
          addHit({
            kind: "event",
            objectId: event.id ?? `line:${lineIndex}:event:${type}:${eventIndex}`,
            lineId,
            lineIndex,
            coordinateSpace: request.coordinateSpace ?? "chart-time",
            time,
            eventLayer: eventLayerFor(type, queryEventLayer),
            eventType: type,
            eventIndex,
            eventValue: eventValueAt(event, time.seconds, tempo, line.bpmfactor ?? 1),
            eventStart: copiedValue(event.start),
            eventEnd: copiedValue(event.end),
            easingType: event.easingType ?? 1,
            easingLeft: event.easingLeft ?? 0,
            easingRight: event.easingRight ?? 1,
            startTime: copiedBeat(event.startTime),
            endTime: copiedBeat(event.endTime),
          });
        }
      }
    }
  }
  return {
    hits: results,
    totalHits,
    truncated: totalHits > results.length,
    ordering: "lineIndex,notes,judgeLine,eventTrack,eventIndex",
  };
}
