/**
 * The pure chart issue scan: structural range checks plus the density estimate.
 *
 * A worker runs this over a chart snapshot, so nothing here reaches editor
 * state, the DOM, or a value cell. One call returns both the structural issues
 * and the density issues, already located by line, layer, track, and beat, so
 * the publishing side never has to reconstruct chart context.
 */
import type {
  Chart,
  JudgeLine,
  JudgeLineEvent,
  JudgeLineNote,
  LineEventLayer,
} from "../../global/chart/chart.ts";
import {
  EVENT_TYPES,
  EXTENDED_TYPES,
  MAX_BASE_EVENT_LAYERS,
  type EventTrackName,
} from "../../global/chart/chartVocabulary.ts";
import { beatValue, compareBeats, type Beat } from "../../global/chart/timing/beat.ts";
import { TempoMap } from "../../global/chart/timing/tempo.ts";
import type { ChartIssueKind, ChartIssueSeverity } from "./chartIssueTypes.ts";
import { chartIssueKindDefinition } from "./chartIssueTypes.ts";
import { eventOverlapPairs } from "./eventOverlap.ts";
import { scanNoteDensity, type NoteDensityOptions } from "./noteDensityScan.ts";

/** Which checks one scan runs. */
export interface ChartIssueScanOptions {
  /** Per-kind switches, keyed by issue kind. A missing kind means enabled. */
  checks: Readonly<Partial<Record<ChartIssueKind, boolean>>>;
  /** Density model parameters, read from the settings page. */
  densityOptions: NoteDensityOptions;
}

/** Whether one kind is enabled for this scan. */
function checkEnabled(options: ChartIssueScanOptions, kind: ChartIssueKind): boolean {
  return options.checks[kind] !== false;
}

/** One scan request. */
export interface ChartIssueScanInput {
  chart: Chart;
  options: ChartIssueScanOptions;
}

/** One scan result. */
export interface ChartIssueScanResult {
  issues: ScannedIssue[];
  /** The highest same-time note count the density model found, or zero. */
  densityPeak: number;
}

/** One located issue, before the publisher freezes the list. */
export interface ScannedIssue {
  kind: ChartIssueKind;
  severity: ChartIssueSeverity;
  target: "event" | "hold" | "note" | "line";
  id: string;
  lineIndex: number;
  lineId: string;
  lineName: string;
  layer: number;
  extended: boolean;
  track: string;
  firstEventIndex: number;
  secondEventIndex: number;
  firstEventId: string;
  secondEventId: string;
  startTime: Beat;
  endTime: Beat;
  /** The same range in chart seconds, for a clock readout. */
  startSeconds: number;
  endSeconds: number;
  beat: number;
  endBeat: number;
  peak?: number;
}

/** A malformed range found on one line, before its chart context is added. */
interface RangeEntry {
  index: number;
  id: string;
  startTime: Beat;
  endTime: Beat;
  beat: number;
  endBeat: number;
}

/** Resolve one chart's tempo map, or null when its BPM list is unusable. */
function chartTempo(chart: Chart): TempoMap | null {
  const entries = Array.isArray(chart.BPMList) ? chart.BPMList : [];
  if (!entries.length) {
    return null;
  }
  try {
    return new TempoMap(entries);
  } catch {
    return null;
  }
}

/** Convert a beat range to chart seconds for the clock readout. */
type SecondsOf = (beat: readonly number[], factor: number) => number;

/** Scan one chart snapshot and return every located issue. */
export function scanChartIssues(input: ChartIssueScanInput): ChartIssueScanResult {
  const chart = input.chart;
  const issues: ScannedIssue[] = [];
  const lines = Array.isArray(chart.judgeLineList) ? chart.judgeLineList : [];
  // Beats are what the chart stores, but a reader thinks in clock time. One
  // tempo map converts every reported range, and a chart without a usable BPM
  // list leaves the seconds at the beat value so the readout still exists.
  const tempo = chartTempo(chart);
  const secondsOf = (beat: readonly number[], factor: number): number => {
    if (!tempo) {
      return beatValue(beat);
    }
    try {
      return tempo.seconds(beat, factor);
    } catch {
      return beatValue(beat);
    }
  };
  const structural =
    checkEnabled(input.options, "overlap") ||
    checkEnabled(input.options, "invalid-range") ||
    checkEnabled(input.options, "negative-beat");
  if (structural) {
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (line) {
        appendLineIssues(issues, line, lineIndex, input.options, secondsOf);
      }
    }
  }
  let densityPeak = 0;
  if (checkEnabled(input.options, "density")) {
    const scan = scanNoteDensity(chart, input.options.densityOptions);
    densityPeak = scan.peak;
    for (const range of scan.ranges) {
      const lineIndex = range.lines[0] ?? 0;
      const line = lines[lineIndex];
      issues.push({
        id: `density:${range.startSeconds.toFixed(3)}:${range.peak}`,
        kind: "density",
        severity: chartIssueKindDefinition("density").severity,
        target: "line",
        lineIndex,
        lineId: String(line?.id ?? `line-${lineIndex}`),
        lineName: line?.Name?.trim() ?? "",
        layer: -1,
        extended: false,
        track: "notes",
        firstEventIndex: -1,
        secondEventIndex: -1,
        firstEventId: "",
        secondEventId: "",
        startTime: range.startTime,
        endTime: range.endTime,
        startSeconds: range.startSeconds,
        endSeconds: range.endSeconds,
        beat: beatValue(range.startTime),
        endBeat: beatValue(range.endTime),
        peak: range.peak,
      });
    }
  }
  issues.sort(
    (left, right) =>
      left.beat - right.beat ||
      left.lineIndex - right.lineIndex ||
      left.kind.localeCompare(right.kind) ||
      left.firstEventIndex - right.firstEventIndex ||
      left.secondEventIndex - right.secondEventIndex,
  );
  return { issues, densityPeak };
}

/** Append every issue that belongs to one line. */
function appendLineIssues(
  issues: ScannedIssue[],
  line: JudgeLine,
  lineIndex: number,
  options: ChartIssueScanOptions,
  secondsOf: SecondsOf,
): void {
  // Every event and note on this line shares its time-rate multiplier, so it is
  // resolved once here and threaded into the row builders.
  const factor = line.bpmfactor ?? 1;
  const layers = Array.isArray(line.eventLayers) ? line.eventLayers : [];
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    if (!layer) {
      continue;
    }
    for (const track of EVENT_TYPES) {
      appendTrackIssues(
        issues,
        line,
        lineIndex,
        layerIndex,
        false,
        track,
        layer,
        options,
        secondsOf,
        factor,
      );
    }
  }
  if (line.extended) {
    for (const track of EXTENDED_TYPES) {
      appendTrackIssues(
        issues,
        line,
        lineIndex,
        MAX_BASE_EVENT_LAYERS,
        true,
        track,
        line.extended,
        options,
        secondsOf,
        factor,
      );
    }
  }
  appendHoldIssues(issues, line, lineIndex, options, secondsOf, factor);
}

/** Append one track's overlap, negative-beat, and invalid-range issues. */
function appendTrackIssues(
  issues: ScannedIssue[],
  line: JudgeLine,
  lineIndex: number,
  layer: number,
  extended: boolean,
  track: EventTrackName,
  segment: LineEventLayer,
  options: ChartIssueScanOptions,
  secondsOf: SecondsOf,
  factor: number,
): void {
  const events = segment[track];
  if (!events?.length) {
    return;
  }
  const lineId = String(line.id ?? `line-${lineIndex}`);
  const lineName = line.Name?.trim() ?? "";
  if (checkEnabled(options, "negative-beat")) {
    for (const entry of negativeRangeEntries(events)) {
      issues.push({
        id: `${lineId}:${layer}:${track}:negative:${entry.id}:${entry.index}`,
        kind: "negative-beat",
        severity: chartIssueKindDefinition("negative-beat").severity,
        target: "event",
        lineIndex,
        lineId,
        lineName,
        layer,
        extended,
        track,
        firstEventIndex: entry.index,
        secondEventIndex: entry.index,
        firstEventId: entry.id,
        secondEventId: entry.id,
        startTime: [...entry.startTime] as Beat,
        endTime: [...entry.endTime] as Beat,
        startSeconds: secondsOf(entry.startTime, factor),
        endSeconds: secondsOf(entry.endTime, factor),
        beat: entry.beat,
        endBeat: entry.endBeat,
      });
    }
  }
  if (checkEnabled(options, "invalid-range")) {
    for (const entry of invalidEventRangeEntries(events)) {
      issues.push({
        id: `${lineId}:${layer}:${track}:invalid:${entry.id}:${entry.index}`,
        kind: "invalid-range",
        severity: chartIssueKindDefinition("invalid-range").severity,
        target: "event",
        lineIndex,
        lineId,
        lineName,
        layer,
        extended,
        track,
        firstEventIndex: entry.index,
        secondEventIndex: entry.index,
        firstEventId: entry.id,
        secondEventId: entry.id,
        startTime: [...entry.startTime] as Beat,
        endTime: [...entry.endTime] as Beat,
        startSeconds: secondsOf(entry.startTime, factor),
        endSeconds: secondsOf(entry.endTime, factor),
        beat: entry.beat,
        endBeat: entry.endBeat,
      });
    }
  }
  if (!checkEnabled(options, "overlap") || events.length < 2) {
    return;
  }
  for (const pair of eventOverlapPairs(events)) {
    const firstEventId = String(events[pair.firstIndex]?.id ?? pair.firstIndex);
    const secondEventId = String(events[pair.secondIndex]?.id ?? pair.secondIndex);
    issues.push({
      id: `${lineId}:${layer}:${track}:${firstEventId}:${secondEventId}`,
      kind: "overlap",
      severity: chartIssueKindDefinition("overlap").severity,
      target: "event",
      lineIndex,
      lineId,
      lineName,
      layer,
      extended,
      track,
      firstEventIndex: pair.firstIndex,
      secondEventIndex: pair.secondIndex,
      firstEventId,
      secondEventId,
      startTime: pair.startTime,
      endTime: pair.endTime,
      startSeconds: secondsOf(pair.startTime, factor),
      endSeconds: secondsOf(pair.endTime, factor),
      beat: beatValue(pair.startTime),
      endBeat: beatValue(pair.endTime),
    });
  }
}

/** Append every Hold whose stored range has no forward duration. */
function appendHoldIssues(
  issues: ScannedIssue[],
  line: JudgeLine,
  lineIndex: number,
  options: ChartIssueScanOptions,
  secondsOf: SecondsOf,
  factor: number,
): void {
  const notes = Array.isArray(line.notes) ? line.notes : [];
  if (!notes.length) {
    return;
  }
  const lineId = String(line.id ?? `line-${lineIndex}`);
  const lineName = line.Name?.trim() ?? "";
  if (checkEnabled(options, "negative-beat")) {
    for (const entry of negativeRangeEntries(notes)) {
      issues.push({
        id: `${lineId}:notes:negative:${entry.id}:${entry.index}`,
        kind: "negative-beat",
        severity: chartIssueKindDefinition("negative-beat").severity,
        target: "note",
        lineIndex,
        lineId,
        lineName,
        layer: -1,
        extended: false,
        track: "notes",
        firstEventIndex: entry.index,
        secondEventIndex: entry.index,
        firstEventId: entry.id,
        secondEventId: entry.id,
        startTime: [...entry.startTime] as Beat,
        endTime: [...entry.endTime] as Beat,
        startSeconds: secondsOf(entry.startTime, factor),
        endSeconds: secondsOf(entry.endTime, factor),
        beat: entry.beat,
        endBeat: entry.endBeat,
      });
    }
  }
  if (checkEnabled(options, "invalid-range")) {
    for (const entry of invalidHoldRangeEntries(notes)) {
      issues.push({
        id: `${lineId}:notes:invalid:${entry.id}:${entry.index}`,
        kind: "invalid-range",
        severity: chartIssueKindDefinition("invalid-range").severity,
        target: "hold",
        lineIndex,
        lineId,
        lineName,
        layer: -1,
        extended: false,
        track: "notes",
        firstEventIndex: entry.index,
        secondEventIndex: entry.index,
        firstEventId: entry.id,
        secondEventId: entry.id,
        startTime: [...entry.startTime] as Beat,
        endTime: [...entry.endTime] as Beat,
        startSeconds: secondsOf(entry.startTime, factor),
        endSeconds: secondsOf(entry.endTime, factor),
        beat: entry.beat,
        endBeat: entry.endBeat,
      });
    }
  }
}

/** Every event whose start or end beat is negative. */
function negativeRangeEntries(
  events: readonly JudgeLineEvent[] | readonly JudgeLineNote[],
): RangeEntry[] {
  const entries: RangeEntry[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const source = events[index];
    if (
      !source ||
      (compareBeats(source.startTime, [0, 0, 1]) >= 0 &&
        compareBeats(source.endTime, [0, 0, 1]) >= 0)
    ) {
      continue;
    }
    entries.push(rangeEntry(source, index));
  }
  return entries;
}

/** Every event whose stored range has no forward duration. */
function invalidEventRangeEntries(events: readonly JudgeLineEvent[]): RangeEntry[] {
  const entries: RangeEntry[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event || compareBeats(event.endTime, event.startTime) > 0) {
      continue;
    }
    entries.push(rangeEntry(event, index));
  }
  return entries;
}

/** Every Hold whose stored range has no forward duration. */
function invalidHoldRangeEntries(notes: readonly JudgeLineNote[]): RangeEntry[] {
  const entries: RangeEntry[] = [];
  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index];
    if (!note || note.type !== 2 || compareBeats(note.endTime, note.startTime) > 0) {
      continue;
    }
    entries.push(rangeEntry(note, index));
  }
  return entries;
}

/** Read the located fields shared by an event and a Hold. */
function rangeEntry(source: JudgeLineEvent | JudgeLineNote, index: number): RangeEntry {
  return {
    index,
    id: String(source.id ?? index),
    startTime: source.startTime,
    endTime: source.endTime,
    beat: beatValue(source.startTime),
    endBeat: beatValue(source.endTime),
  };
}
