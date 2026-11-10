/**
 * Builds the per-line summaries and chart header used by the streaming
 * document. A line is parsed once here, summarized, and discarded; the summary
 * carries the counts, time bounds, parent/group identity, and content digest
 * needed by paging, rendering, and save without retaining note objects.
 */
import { isRecord } from "../../../utils/guards.ts";
import { EVENT_TRACKS } from "../chartVocabulary.ts";
import { lineParentIndex, type BpmEntry, type ChartMeta, type JudgeLine } from "../chart.ts";
import { assertJudgeLineStructure } from "../chartValidation.ts";
import type { BlockArea } from "../noise/blockArea.ts";
import { beatValue } from "../timing/beat.ts";
import { TempoMap } from "../timing/tempo.ts";
import { isChartObjectId } from "../identity.ts";
import { lineContentFingerprint, headerContentFingerprint } from "./chartContentHash.ts";
import type { ChartJsonScan } from "./chartJsonScanner.ts";
import {
  LINE_FLAG_IDS,
  LINE_FLAG_INVALID,
  LINE_FLAG_NOISE,
  LINE_FLAG_SHADER,
  LINE_FLAG_STATIC,
  LINE_FLAG_UNBOUNDED,
  type ChartHeader,
  type ChartIndex,
  type ChartLineSummary,
} from "./chartStreamTypes.ts";

/** Seconds for a beat tuple, or null when the tuple is malformed. */
function secondsOf(value: unknown, tempo: TempoMap, factor: number): number | null {
  try {
    const beat = Array.isArray(value) ? beatValue(value) : Number(value);
    return Number.isFinite(beat) ? tempo.seconds(beat, factor) : null;
  } catch {
    return null;
  }
}

/** Extend a running time bound with one finite value. */
function extend(
  bounds: { start: number; end: number; timed: boolean },
  seconds: number | null,
): void {
  if (seconds === null || !Number.isFinite(seconds)) {
    return;
  }
  bounds.start = Math.min(bounds.start, seconds);
  bounds.end = Math.max(bounds.end, seconds);
  bounds.timed = true;
}

/** Add one finite interval to a line's activity list. */
function addInterval(
  intervals: [number, number][],
  start: number | null,
  end: number | null,
): void {
  if (start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end)) {
    return;
  }
  intervals.push([Math.max(0, start), Math.max(start, end)]);
}

/** Merge sorted or unsorted intervals into disjoint ranges. */
function mergeIntervals(intervals: readonly [number, number][]): [number, number][] {
  if (intervals.length <= 1) {
    return [...intervals];
  }
  const ordered = [...intervals].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: [number, number][] = [[...ordered[0]]];
  for (const interval of ordered.slice(1)) {
    const current = merged[merged.length - 1];
    if (interval[0] <= current[1]) {
      current[1] = Math.max(current[1], interval[1]);
    } else {
      merged.push([...interval]);
    }
  }
  return merged;
}

/** Read the line's `bpmfactor` with the tempo map's own fallback rule. */
function lineFactor(line: Record<string, unknown>): number {
  const value = Number(line.bpmfactor ?? 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** Summarize one line without retaining any note or event object. */
export function summarizeChartLine(
  line: unknown,
  index: number,
  tempo: TempoMap,
  byteOffset = 0,
  byteLength = 0,
): ChartLineSummary {
  const digest = lineContentFingerprint(line);
  if (!isRecord(line)) {
    return {
      index,
      byteOffset,
      byteLength,
      noteCount: 0,
      eventCount: 0,
      startSeconds: null,
      endSeconds: null,
      digest,
      flags: LINE_FLAG_INVALID | LINE_FLAG_UNBOUNDED,
      group: 0,
      father: -1,
    };
  }

  const factor = lineFactor(line);
  const bounds = { start: Number.POSITIVE_INFINITY, end: Number.NEGATIVE_INFINITY, timed: false };
  const intervals: [number, number][] = [];
  let eventCount = 0;
  let hasAlphaEvents = false;
  let lastAlphaEnd: number | null = null;
  let lastAlphaEndValue = Number.NaN;
  let hasShader = false;
  let allIds = isChartObjectId(line.id);

  const notes = Array.isArray(line.notes) ? line.notes : [];
  const noteCount = notes.length;
  for (const note of notes) {
    if (!isRecord(note)) {
      continue;
    }
    if (!isChartObjectId(note.id)) {
      allIds = false;
    }
    const start = secondsOf(note.startTime, tempo, factor);
    const end = secondsOf(note.endTime, tempo, factor);
    extend(bounds, start);
    extend(bounds, end);
    const visibleTime = Number(note.visibleTime ?? 999999);
    if (start !== null && Number.isFinite(visibleTime)) {
      extend(bounds, start - visibleTime);
      addInterval(intervals, start - visibleTime, end);
    } else {
      addInterval(intervals, start, end);
    }
  }

  const layers = [...(Array.isArray(line.eventLayers) ? line.eventLayers : []), line.extended];
  for (const layer of layers) {
    if (!isRecord(layer)) {
      continue;
    }
    for (const type of EVENT_TRACKS) {
      const events = layer[type];
      if (!Array.isArray(events)) {
        continue;
      }
      eventCount += events.length;
      if (type === "paintEvents" && events.length) {
        hasShader = true;
      }
      for (const event of events) {
        if (!isRecord(event)) {
          continue;
        }
        if (!isChartObjectId(event.id)) {
          allIds = false;
        }
        const start = secondsOf(event.startTime, tempo, factor);
        const end = secondsOf(event.endTime, tempo, factor);
        extend(bounds, start);
        extend(bounds, end);
        addInterval(intervals, start, end);
        if (type === "alphaEvents") {
          hasAlphaEvents = true;
          if (end !== null && (lastAlphaEnd === null || end >= lastAlphaEnd)) {
            lastAlphaEnd = end;
            lastAlphaEndValue = Number(event.end);
          }
        }
      }
    }
  }

  const unbounded =
    !hasAlphaEvents ||
    lastAlphaEnd === null ||
    !Number.isFinite(lastAlphaEndValue) ||
    lastAlphaEndValue > 0;
  let flags = 0;
  if (unbounded) {
    flags |= LINE_FLAG_UNBOUNDED;
  }
  if (!bounds.timed) {
    flags |= LINE_FLAG_STATIC;
  }
  if (hasShader) {
    flags |= LINE_FLAG_SHADER;
  }
  if (Object.hasOwn(line, "_reduxNoiseLine")) {
    flags |= LINE_FLAG_NOISE;
  }
  if (allIds) {
    flags |= LINE_FLAG_IDS;
  }

  const startSeconds = bounds.timed ? Math.max(0, bounds.start) : null;
  const endSeconds = unbounded || !bounds.timed ? null : Math.max(bounds.start, bounds.end);
  if (unbounded) {
    intervals.push([
      lastAlphaEnd === null ? 0 : Math.max(0, lastAlphaEnd),
      Number.MAX_SAFE_INTEGER,
    ]);
  }
  return {
    index,
    byteOffset,
    byteLength,
    noteCount,
    eventCount,
    startSeconds,
    endSeconds,
    intervals: mergeIntervals(intervals),
    digest,
    flags,
    group: Number.isFinite(Number(line.Group)) ? Number(line.Group) : 0,
    father: lineParentIndex(line.father),
    ...(typeof line.id === "string" ? { id: line.id } : {}),
  };
}

/** Build a header from the scanner's top-level values. */
export function chartHeaderFromScan(scan: ChartJsonScan): ChartHeader {
  const values = scan.header;
  const extras: Record<string, unknown> = { ...values };
  delete extras.META;
  delete extras.BPMList;
  delete extras.judgeLineGroup;
  delete extras.blockAreaList;
  delete extras.effects;
  delete extras.shaderEvents;
  delete extras.markers;
  return {
    META: (isRecord(values.META) ? values.META : {}) as ChartMeta,
    BPMList: Array.isArray(values.BPMList) ? (values.BPMList as BpmEntry[]) : [],
    ...(Array.isArray(values.judgeLineGroup)
      ? { judgeLineGroup: values.judgeLineGroup as string[] }
      : {}),
    ...(Array.isArray(values.blockAreaList)
      ? { blockAreaList: values.blockAreaList as BlockArea[] }
      : {}),
    ...(Array.isArray(values.effects) ? { effects: values.effects } : {}),
    ...(Array.isArray(values.shaderEvents) ? { shaderEvents: values.shaderEvents } : {}),
    ...(Array.isArray(values.markers) ? { markers: values.markers } : {}),
    extras,
    lineCount: scan.lineRanges.length,
  };
}

/** Collect chart asset names from the header and one parsed line. */
function collectAssetNames(line: unknown, names: Set<string>): void {
  if (!isRecord(line)) {
    return;
  }
  for (const field of ["Texture", "attachUI"] as const) {
    if (typeof line[field] === "string") {
      names.add(line[field] as string);
    }
  }
  if (!Array.isArray(line.notes)) {
    return;
  }
  for (const note of line.notes) {
    if (!isRecord(note)) {
      continue;
    }
    for (const field of ["hitSound", "hitsound"] as const) {
      if (typeof note[field] === "string") {
        names.add(note[field] as string);
      }
    }
  }
}

/**
 * Build a line index from one scanned chart text.
 *
 * Every line is parsed once so counts and digests are exact; the parsed object
 * is discarded immediately and never retained by the index.
 */
export function buildChartIndex(scan: ChartJsonScan, tempo: TempoMap): ChartIndex {
  const header = chartHeaderFromScan(scan);
  const headerChart = { ...scan.header, judgeLineList: [] };
  const headerDigest = headerContentFingerprint(headerChart);
  const names = new Set<string>();
  for (const field of ["song", "background"] as const) {
    if (typeof header.META[field] === "string") {
      names.add(header.META[field] as string);
    }
  }
  const lines: ChartLineSummary[] = [];
  for (const [index, range] of scan.lineRanges.entries()) {
    let line: unknown;
    try {
      line = JSON.parse(scan.text.slice(range.start, range.end));
    } catch {
      line = null;
    }
    collectAssetNames(line, names);
    const summary = summarizeChartLine(line, index, tempo, range.start, range.end - range.start);
    if (line !== null) {
      try {
        assertJudgeLineStructure(line as JudgeLine, index);
      } catch {
        lines.push({ ...summary, flags: summary.flags | LINE_FLAG_INVALID });
        continue;
      }
    }
    lines.push(summary);
  }
  return {
    version: 1,
    headerDigest,
    lines,
    assetNames: [...names].sort(),
    totalBytes: scan.text.length,
    canonical: false,
  };
}
