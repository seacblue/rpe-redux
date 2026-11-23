/** Computes the authored content bounds used by scripts and chart tools. */
import { isRecord } from "../../utils/guards.ts";
import { beatValue } from "./timing/beat.ts";
import { TempoMap } from "./timing/tempo.ts";
import { shaderEvents } from "./shader/shaderEvents.ts";
import type { Chart } from "./chart.ts";

/** The authored content range; it is not the audio file duration. */
export interface ChartContentRange {
  readonly startBeat: number | null;
  readonly endBeat: number | null;
  readonly startSeconds: number | null;
  readonly endSeconds: number | null;
}

/** Read a beat tuple or scalar without allowing malformed chart data to abort a read. */
function readBeat(value: unknown): number | null {
  try {
    const beat = Array.isArray(value) ? beatValue(value) : Number(value);
    return Number.isFinite(beat) ? beat : null;
  } catch {
    return null;
  }
}

/** Extend a numeric beat bound with one authored time value. */
function extendBeat(bounds: { start: number; end: number }, value: unknown): void {
  const beat = readBeat(value);
  if (beat === null) {
    return;
  }
  bounds.start = Math.min(bounds.start, beat);
  bounds.end = Math.max(bounds.end, beat);
}

/** Add the start and end times carried by one note or event. */
function extendTimedObject(bounds: { start: number; end: number }, value: unknown): void {
  if (!isRecord(value)) {
    return;
  }
  extendBeat(bounds, value.startTime);
  extendBeat(bounds, value.endTime);
}

/** Visit every ordinary event track on one judge line. */
function extendLineTracks(bounds: { start: number; end: number }, line: unknown): void {
  if (!isRecord(line)) {
    return;
  }
  const tracks = [
    ...(Array.isArray(line.notes) ? [line.notes] : []),
    ...(Array.isArray(line.eventLayers) ? line.eventLayers : []),
    ...(isRecord(line.extended) ? [line.extended] : []),
  ];
  for (const track of tracks) {
    if (Array.isArray(track)) {
      for (const item of track) {
        extendTimedObject(bounds, item);
      }
      continue;
    }
    if (!isRecord(track)) {
      continue;
    }
    for (const events of Object.values(track)) {
      if (Array.isArray(events)) {
        for (const event of events) {
          extendTimedObject(bounds, event);
        }
      }
    }
  }
}

/** Compute the authored note/event/shader range in both beat and seconds. */
export function chartContentRange(chart: Chart | null | undefined): ChartContentRange {
  if (!chart) {
    return { startBeat: null, endBeat: null, startSeconds: null, endSeconds: null };
  }
  const bounds = { start: Number.POSITIVE_INFINITY, end: Number.NEGATIVE_INFINITY };
  for (const [lineIndex, line] of (chart.judgeLineList ?? []).entries()) {
    extendLineTracks(bounds, line);
    for (const event of shaderEvents(chart, lineIndex)) {
      extendTimedObject(bounds, event);
    }
  }
  if (!Number.isFinite(bounds.start) || !Number.isFinite(bounds.end)) {
    return { startBeat: null, endBeat: null, startSeconds: null, endSeconds: null };
  }
  let startSeconds: number | null = null;
  let endSeconds: number | null = null;
  try {
    const tempo = new TempoMap(chart.BPMList);
    startSeconds = tempo.seconds(bounds.start);
    endSeconds = tempo.seconds(bounds.end);
  } catch {
    // A malformed or incomplete BPM list still has useful beat bounds.
  }
  return {
    startBeat: bounds.start,
    endBeat: bounds.end,
    startSeconds,
    endSeconds,
  };
}
