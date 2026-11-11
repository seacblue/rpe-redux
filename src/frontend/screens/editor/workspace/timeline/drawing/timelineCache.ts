/**
 * Caches the timeline's derived note and event queries, overlap chains, palette,
 * and reusable canvas layers so drawing and hit testing avoid rebuilding chart
 * indexes every frame.
 *
 * Invalidation is explicit; the chart rules themselves stay in
 * `core/edit/timeline`.
 */
import { IntervalIndex } from "../../../../../../core/utils/intervalIndex.ts";
import type { IntervalEntry } from "../../../../../../core/utils/intervalIndex.ts";
import { beatValue } from "../../../../../../core/global/chart/timing/beat.ts";
import type {
  Chart,
  JudgeLineEvent,
  JudgeLineNote,
} from "../../../../../../core/global/chart/chart.ts";
import type { TempoSource } from "../../../../../../core/global/chart/timing/events.ts";
import {
  eventChains,
  overlappingEventIndexes,
  type EventChain,
} from "../../../../../../core/edit/timeline/eventChains.ts";
import { shaderEventLanes } from "../../../../../../core/global/chart/shader/shaderEvents.ts";
import {
  overlappingNoteRanks,
  type NoteOverlapRanks,
} from "../../../../../../core/edit/timeline/noteOverlap.ts";
import {
  checkedNotes,
  isTimelineNoteRenderable,
  timelineRenderRange,
} from "../../../../../../core/edit/timeline/model.ts";
import { refreshNoteIndex } from "../../../../../../core/edit/timeline/noteIndex.ts";
import type {
  NoteIndex,
  TimelineNote,
  TimelineNoteEntry,
  TimelineEventLayer,
} from "../../../../../../core/edit/timeline/types.ts";
import type { TimelinePalette } from "./canvas.ts";
import { readCanvasPalette, selectionColor } from "../../../canvas/palette.ts";
import { sizeCanvasBackingStore } from "../../../canvas/canvas2d.ts";

export interface TimelineEventDisplay {
  readonly length: number;
  readonly index: IntervalIndex<JudgeLineEvent>;
  readonly groups: EventChain<JudgeLineEvent>[];
  readonly ranges: Map<number, EventChain<JudgeLineEvent>>;
  readonly overlaps: Set<number>;
}

interface CachedEventQuery {
  readonly start: number;
  readonly end: number;
  readonly gridCount: number;
  readonly entries: readonly IntervalEntry<JudgeLineEvent>[];
}

interface CachedNoteQuery {
  readonly notes: TimelineNote[];
  readonly bottom: number;
  readonly top: number;
  readonly entries: TimelineNoteEntry[];
}

interface CanvasLayerState {
  readonly key: string;
  readonly width: number;
  readonly height: number;
}

export interface CachedCanvasLayer {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly repaint: boolean;
}

/** Owns derived data and its invalidation. Callers never replace raw cache keys. */
export class TimelineCache {
  private readonly noteIndexes = new Map<number, NoteIndex>();
  /** One visible-range result per line; pointer hit tests and painting share it. */
  private readonly noteQueries = new Map<number, CachedNoteQuery>();
  private validatedNoteArrays = new WeakSet<JudgeLineNote[]>();
  private noteOverlaps = new WeakMap<
    readonly TimelineNote[],
    { threshold: number; ranks: NoteOverlapRanks }
  >();

  private eventDisplays = new WeakMap<readonly JudgeLineEvent[], TimelineEventDisplay>();
  private eventQueries = new WeakMap<readonly JudgeLineEvent[], CachedEventQuery>();
  private canvasLayers = new WeakMap<
    HTMLCanvasElement,
    { canvas: HTMLCanvasElement; state?: CanvasLayerState }
  >();
  private tempoSecondsCache = new WeakMap<object, Map<number, Map<number, number>>>();
  private eventData?: {
    chart: Chart;
    key: string;
    indexes: IntervalIndex<JudgeLineEvent>[];
    ranges: Map<number, EventChain<JudgeLineEvent>>[];
    overlaps: Set<number>[];
    lanes: Map<number, { lane: number; count: number }>;
  };
  private theme?: string;
  private colors?: TimelinePalette;

  /** Return a reusable layer canvas, flagging `repaint` when its key or size changed. */
  canvasLayer(
    target: HTMLCanvasElement,
    key: string,
    width: number,
    height: number,
  ): CachedCanvasLayer | undefined {
    if (typeof document === "undefined") {
      return undefined;
    }
    let cached = this.canvasLayers.get(target);
    if (!cached) {
      cached = { canvas: document.createElement("canvas") };
      this.canvasLayers.set(target, cached);
    }
    const canvas = cached.canvas;
    const previousWidth = canvas.width;
    const previousHeight = canvas.height;
    const size = sizeCanvasBackingStore(canvas, { width, height });
    const repaint =
      cached.state?.key !== key ||
      cached.state?.width !== width ||
      cached.state?.height !== height ||
      previousWidth !== size.width ||
      previousHeight !== size.height;
    if (repaint) {
      cached.state = { key, width, height };
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return undefined;
    }
    context.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
    if (repaint) {
      context.clearRect(0, 0, width, height);
    }
    return {
      canvas,
      context,
      repaint,
    };
  }

  /**
   * Validate one line's notes once per immutable array, then index them.
   *
   * Validation is memoized here because drawing and hit testing both refresh
   * the same line on every frame.
   */
  refreshNotes(lineIndex: number, source: JudgeLineNote[]): NoteIndex | undefined {
    let notes: TimelineNote[];
    if (this.validatedNoteArrays.has(source)) {
      notes = source as TimelineNote[];
    } else {
      notes = checkedNotes(source);
      this.validatedNoteArrays.add(source);
    }
    const previous = this.noteIndexes.get(lineIndex);
    refreshNoteIndex(this.noteIndexes, lineIndex, notes);
    if (previous?.notes !== notes) {
      this.noteQueries.delete(lineIndex);
    }
    return this.noteIndexes.get(lineIndex);
  }

  /** The reader: whatever `refreshNotes` built last, untouched. */
  noteIndex(lineIndex: number): NoteIndex | undefined {
    return this.noteIndexes.get(lineIndex);
  }

  /**
   * Same-beat overlap ranks for one immutable note array.
   *
   * The sweep is O(n log n); painting runs at the frame cadence and a dense
   * line can hold tens of thousands of notes, so the result is cached until the
   * array or the threshold changes.
   */
  noteOverlapRanks(notes: readonly TimelineNote[], threshold: number): NoteOverlapRanks {
    const cached = this.noteOverlaps.get(notes);
    if (cached?.threshold === threshold) {
      return cached.ranks;
    }
    const ranks = overlappingNoteRanks(notes, threshold);
    this.noteOverlaps.set(notes, { threshold, ranks });
    return ranks;
  }

  /** Query one line's visible notes once per range shared by hit testing and painting. */
  visibleNotes(lineIndex: number, bottom: number, top: number): TimelineNoteEntry[] {
    const noteIndex = this.noteIndexes.get(lineIndex);
    if (!noteIndex) {
      return [];
    }
    const cached = this.noteQueries.get(lineIndex);
    if (cached?.notes === noteIndex.notes && cached.bottom === bottom && cached.top === top) {
      return cached.entries;
    }
    const entries = noteIndex.index
      .query(bottom, top)
      .filter((entry) => isTimelineNoteRenderable(entry.item))
      .map((entry) => ({ ...entry, lineIndex }));
    this.noteQueries.set(lineIndex, { notes: noteIndex.notes, bottom, top, entries });
    return entries;
  }

  /** Build and memoize the interval index, chains, and overlaps for one event array. */
  eventDisplay(_chart: Chart, events: readonly JudgeLineEvent[]): TimelineEventDisplay {
    // Event displays depend on the event array, not on the chart object that
    // currently owns it, so a chart replacement with unchanged arrays reuses
    // the previous index.
    let display = this.eventDisplays.get(events);
    if (!display || display.length !== events.length) {
      this.eventQueries.delete(events);
      const groups = eventChains(events);
      const ranges = new Map<number, EventChain<JudgeLineEvent>>();
      for (const group of groups) {
        for (const entry of group.entries) {
          ranges.set(entry.index, group);
        }
      }
      display = {
        length: events.length,
        index: new IntervalIndex(
          events,
          (event) => beatValue(event.startTime),
          (event) => Math.max(beatValue(event.startTime), beatValue(event.endTime)),
        ),
        groups,
        ranges,
        overlaps: overlappingEventIndexes(events),
      };
      this.eventDisplays.set(events, display);
    }
    return display;
  }

  /** Query one event array once per visible beat range during a render burst. */
  eventEntries(
    chart: Chart,
    events: readonly JudgeLineEvent[],
    start: number,
    end: number,
    gridCount: number,
  ): readonly IntervalEntry<JudgeLineEvent>[] {
    const cached = this.eventQueries.get(events);
    if (cached?.start === start && cached.end === end && cached.gridCount === gridCount) {
      return cached.entries;
    }
    const entries = this.eventDisplay(chart, events)
      .index.query(start, end)
      .map((entry) => {
        const range = timelineRenderRange(entry.item.startTime, entry.item.endTime, gridCount);
        return { ...entry, start: range.start, end: range.end };
      })
      .sort((left, right) => left.index - right.index);
    this.eventQueries.set(events, { start, end, gridCount, entries });
    return entries;
  }

  /** Per-layer indexes, chains, overlaps, and shader lanes for the current chart and key. */
  events(chart: Chart, key: string, types: string[], layer: TimelineEventLayer) {
    if (this.eventData?.chart !== chart || this.eventData.key !== key) {
      const displays = types.map((type) => this.eventDisplay(chart, layer[type] ?? []));
      this.eventData = {
        chart,
        key,
        indexes: displays.map((display) => display.index),
        ranges: displays.map((display) => display.ranges),
        overlaps: displays.map((display) => display.overlaps),
        lanes: shaderEventLanes(layer.paintEvents ?? []),
      };
    }
    return this.eventData;
  }

  /** Shader lane placement for one paint-event index, when cached. */
  shaderLane(index: number) {
    return this.eventData?.lanes.get(index);
  }

  /** Event chain covering one channel index, when cached. */
  eventRange(channel: number, index: number) {
    return this.eventData?.ranges[channel]?.get(index);
  }

  /** Cache repeated beat-to-second conversions while a dense event layer is painted. */
  tempoSeconds(tempo: TempoSource, beat: number, factor: number): number {
    const normalizedFactor = Number.isFinite(factor) && Math.abs(factor) >= 0.001 ? factor : 1;
    let byFactor = this.tempoSecondsCache.get(tempo);
    if (!byFactor) {
      byFactor = new Map();
      this.tempoSecondsCache.set(tempo, byFactor);
    }
    let byBeat = byFactor.get(normalizedFactor);
    if (!byBeat) {
      byBeat = new Map();
      byFactor.set(normalizedFactor, byBeat);
    }
    const cached = byBeat.get(beat);
    if (cached !== undefined) {
      return cached;
    }
    const seconds = tempo.seconds(beat, normalizedFactor);
    // Keep pathological charts from turning this cache into an unbounded store.
    if (byBeat.size >= 131072) {
      byBeat.clear();
    }
    byBeat.set(beat, seconds);
    return seconds;
  }

  /** Return the canvas palette, refreshed when the theme, skin, or accent changes. */
  palette(): TimelinePalette | undefined {
    if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
      return this.colors;
    }
    const root = document.documentElement;
    const theme = [
      root.dataset.theme,
      root.dataset.skin,
      root.style?.getPropertyValue?.("--accent") ?? "",
      selectionColor("selected-note-color", "#00C800"),
      selectionColor("selected-event-color", "#00C800"),
      selectionColor("collaboration-selected-note-color", "#FFCC66"),
      selectionColor("collaboration-selected-event-color", "#FFCC66"),
    ].join("|");
    if (this.theme !== theme) {
      this.colors = readCanvasPalette();
      this.theme = theme;
    }
    return this.colors;
  }

  /** Drop event, tempo, and layer caches so the next draw rebuilds them. */
  invalidateEvents(): void {
    this.eventData = undefined;
    this.eventDisplays = new WeakMap();
    this.eventQueries = new WeakMap();
    this.tempoSecondsCache = new WeakMap();
    this.canvasLayers = new WeakMap();
  }
  /** Drop every cached index, query, and canvas layer. */
  clear(): void {
    this.noteIndexes.clear();
    this.noteQueries.clear();
    this.validatedNoteArrays = new WeakSet();
    this.noteOverlaps = new WeakMap();
    this.invalidateEvents();
  }
}
