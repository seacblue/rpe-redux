/**
 * Incremental chart issue monitor for event overlaps and invalid holds/ranges.
 *
 * A session notifies on selection and history changes as well as chart commits.
 * The monitor returns immediately while the chart object is unchanged, reuses
 * each line's issue list while the line object is unchanged, and reuses each
 * event track's overlap result while the track array is unchanged. The published
 * snapshot changes only when the visible issue list changes, so the inspector
 * does not re-render on every selection or unrelated edit.
 */
import { createValue, type ValueCell } from "../../state/values.ts";
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
import { eventOverlapPairs, type EventOverlapPair } from "./eventOverlap.ts";

/** One overlapping pair with the chart context needed to locate it. */
export interface ChartIssue {
  /** The issue kind controls how the inspector locates and describes it. */
  kind: "overlap" | "invalid-range";
  /** The chart object represented by this issue. */
  target: "event" | "hold";
  /** Stable key for React and list diffs. */
  id: string;
  lineIndex: number;
  lineId: string;
  /** Raw line name; the view supplies a localized fallback. */
  lineName: string;
  /** Timeline event layer, including the extended layer's synthetic index. */
  layer: number;
  /** True when the pair lives in the line's `extended` map. */
  extended: boolean;
  track: EventTrackName | "notes";
  firstEventIndex: number;
  secondEventIndex: number;
  firstEventId: string;
  secondEventId: string;
  /** First beat shared by both events. */
  startTime: Beat;
  /** First beat after the shared interval. */
  endTime: Beat;
  /** Numeric start used for sorting and seeking. */
  beat: number;
  /** Numeric end used for snapshot equality. */
  endBeat: number;
}

/** One immutable publication consumed by the inspector. */
export interface ChartIssueSnapshot {
  revision: number;
  issues: readonly ChartIssue[];
}

/** Empty snapshot shared until the first chart arrives. */
export const EMPTY_CHART_ISSUE_SNAPSHOT: ChartIssueSnapshot = Object.freeze({
  revision: 0,
  issues: Object.freeze([]),
});

/** Live issue count used by the inspector sidebar's red badge. */
export const chartIssueCount = createValue({ initial: 0 });

/** Per-line cache; the line object is the immutable chart revision key. */
interface LineIssueCache {
  index: number;
  issues: readonly ChartIssue[];
}

/** Line-independent data for an invalid event or Hold range. */
interface InvalidRangeCacheEntry {
  index: number;
  id: string;
  startTime: Beat;
  endTime: Beat;
  beat: number;
  endBeat: number;
}

/** Whether two snapshots describe the same visible issue list. */
function sameIssue(left: ChartIssue, right: ChartIssue): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.target === right.target &&
    left.lineIndex === right.lineIndex &&
    left.lineName === right.lineName &&
    left.layer === right.layer &&
    left.extended === right.extended &&
    left.track === right.track &&
    left.firstEventIndex === right.firstEventIndex &&
    left.secondEventIndex === right.secondEventIndex &&
    left.beat === right.beat &&
    left.endBeat === right.endBeat
  );
}

/** Compare the visible issue lists without allocating a signature string. */
function sameIssues(left: readonly ChartIssue[], right: readonly ChartIssue[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!sameIssue(left[index], right[index])) {
      return false;
    }
  }
  return true;
}

/** Chart issue detection with per-line and per-track reuse. */
export class EventIssueMonitor {
  /** Published snapshot; read-only to consumers. */
  readonly state: ValueCell<ChartIssueSnapshot> = createValue({
    initial: EMPTY_CHART_ISSUE_SNAPSHOT,
  });

  private lastChart: Chart | null = null;
  private revision = 0;
  private readonly lineCache = new WeakMap<JudgeLine, LineIssueCache>();
  private readonly trackCache = new WeakMap<
    readonly JudgeLineEvent[],
    readonly EventOverlapPair[]
  >();
  /** Reuses invalid-range scans when a line clone changes an unrelated field. */
  private readonly invalidEventCache = new WeakMap<
    readonly JudgeLineEvent[],
    readonly InvalidRangeCacheEntry[]
  >();
  /** Reuses invalid-Hold scans when an event edit leaves the notes array intact. */
  private readonly invalidHoldCache = new WeakMap<
    readonly JudgeLineNote[],
    readonly InvalidRangeCacheEntry[]
  >();

  /** Scan one chart, publishing only when the visible issue list changes. */
  update(chart: Chart): ChartIssueSnapshot {
    if (chart === this.lastChart) {
      return this.state.get();
    }
    this.lastChart = chart;
    const issues: ChartIssue[] = [];
    const lines = chart.judgeLineList ?? [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!line) {
        continue;
      }
      const cached = this.lineCache.get(line);
      if (cached?.index === lineIndex) {
        issues.push(...cached.issues);
        continue;
      }
      const next = this.lineIssues(line, lineIndex);
      this.lineCache.set(line, { index: lineIndex, issues: next });
      issues.push(...next);
    }
    issues.sort(
      (left, right) =>
        left.beat - right.beat ||
        left.lineIndex - right.lineIndex ||
        left.layer - right.layer ||
        left.track.localeCompare(right.track) ||
        left.firstEventIndex - right.firstEventIndex ||
        left.secondEventIndex - right.secondEventIndex,
    );
    const previous = this.state.get();
    if (sameIssues(previous.issues, issues)) {
      chartIssueCount.set(issues.length);
      return previous;
    }
    this.revision += 1;
    const snapshot: ChartIssueSnapshot = {
      revision: this.revision,
      issues: Object.freeze(issues),
    };
    this.state.set(snapshot);
    chartIssueCount.set(issues.length);
    return snapshot;
  }

  /** Build every overlap issue for one line, reusing unchanged track arrays. */
  private lineIssues(line: JudgeLine, lineIndex: number): readonly ChartIssue[] {
    const issues: ChartIssue[] = [];
    const layers = Array.isArray(line.eventLayers) ? line.eventLayers : [];
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
      const layer = layers[layerIndex];
      if (!layer) {
        continue;
      }
      for (const track of EVENT_TYPES) {
        this.appendTrackIssues(issues, line, lineIndex, layerIndex, false, track, layer);
      }
    }
    if (line.extended) {
      for (const track of EXTENDED_TYPES) {
        this.appendTrackIssues(
          issues,
          line,
          lineIndex,
          MAX_BASE_EVENT_LAYERS,
          true,
          track,
          line.extended,
        );
      }
    }
    this.appendHoldIssues(issues, line, lineIndex);
    return issues;
  }

  /** Append one track's cached overlap pairs as located issues. */
  private appendTrackIssues(
    issues: ChartIssue[],
    line: JudgeLine,
    lineIndex: number,
    layer: number,
    extended: boolean,
    track: EventTrackName,
    segment: LineEventLayer,
  ): void {
    const events = segment[track];
    if (!events?.length) {
      return;
    }
    this.appendInvalidEventIssues(issues, line, lineIndex, layer, extended, track, events);
    if (events.length < 2) {
      return;
    }
    let overlaps = this.trackCache.get(events);
    if (!overlaps) {
      overlaps = eventOverlapPairs(events);
      this.trackCache.set(events, overlaps);
    }
    if (!overlaps.length) {
      return;
    }
    const lineId = String(line.id ?? `line-${lineIndex}`);
    const lineName = line.Name?.trim() ?? "";
    for (const pair of overlaps) {
      const first = events[pair.firstIndex];
      const second = events[pair.secondIndex];
      const firstEventId = String(first?.id ?? pair.firstIndex);
      const secondEventId = String(second?.id ?? pair.secondIndex);
      issues.push({
        id: `${lineId}:${layer}:${track}:${firstEventId}:${secondEventId}`,
        kind: "overlap",
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
        beat: beatValue(pair.startTime),
        endBeat: beatValue(pair.endTime),
      });
    }
  }

  /** Append one issue for every event whose stored range has no forward duration. */
  private appendInvalidEventIssues(
    issues: ChartIssue[],
    line: JudgeLine,
    lineIndex: number,
    layer: number,
    extended: boolean,
    track: EventTrackName,
    events: readonly JudgeLineEvent[],
  ): void {
    const lineId = String(line.id ?? `line-${lineIndex}`);
    const lineName = line.Name?.trim() ?? "";
    let invalid = this.invalidEventCache.get(events);
    if (!invalid) {
      const next: InvalidRangeCacheEntry[] = [];
      for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
        const event = events[eventIndex];
        if (!event || compareBeats(event.endTime, event.startTime) > 0) {
          continue;
        }
        next.push({
          index: eventIndex,
          id: String(event.id ?? eventIndex),
          startTime: event.startTime,
          endTime: event.endTime,
          beat: beatValue(event.startTime),
          endBeat: beatValue(event.endTime),
        });
      }
      invalid = Object.freeze(next);
      this.invalidEventCache.set(events, invalid);
    }
    for (const entry of invalid) {
      issues.push({
        id: `${lineId}:${layer}:${track}:invalid:${entry.id}:${entry.index}`,
        kind: "invalid-range",
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
        beat: entry.beat,
        endBeat: entry.endBeat,
      });
    }
  }

  /** Append one issue for every Hold note whose stored range has no duration. */
  private appendHoldIssues(issues: ChartIssue[], line: JudgeLine, lineIndex: number): void {
    const notes = line.notes ?? [];
    const lineId = String(line.id ?? `line-${lineIndex}`);
    const lineName = line.Name?.trim() ?? "";
    let invalid = this.invalidHoldCache.get(notes);
    if (!invalid) {
      const next: InvalidRangeCacheEntry[] = [];
      for (let noteIndex = 0; noteIndex < notes.length; noteIndex += 1) {
        const note: JudgeLineNote | undefined = notes[noteIndex];
        if (!note || note.type !== 2 || compareBeats(note.endTime, note.startTime) > 0) {
          continue;
        }
        next.push({
          index: noteIndex,
          id: String(note.id ?? noteIndex),
          startTime: note.startTime,
          endTime: note.endTime,
          beat: beatValue(note.startTime),
          endBeat: beatValue(note.endTime),
        });
      }
      invalid = Object.freeze(next);
      this.invalidHoldCache.set(notes, invalid);
    }
    for (const entry of invalid) {
      issues.push({
        id: `${lineId}:notes:invalid:${entry.id}:${entry.index}`,
        kind: "invalid-range",
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
        beat: entry.beat,
        endBeat: entry.endBeat,
      });
    }
  }
}
