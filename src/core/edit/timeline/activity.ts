/**
 * Per-line time activity for the timeline: the intervals a line's notes and
 * event tracks occupy, indexed for viewport queries.
 *
 * `TimelineActivity.compile` skips work when the chart and tempo objects are
 * unchanged, so a chart edit must produce a new chart object.
 */
import { beatValue } from "../../global/chart/timing/beat.ts";
import { EVENT_TYPES } from "../../global/chart/chart.ts";
import type { Chart, JudgeLine, JudgeLineEvent, LineEventLayer } from "../../global/chart/chart.ts";
import type { TempoSource } from "../../global/chart/timing/events.ts";
import { IntervalIndex } from "../../utils/intervalIndex.ts";
import { shaderEvents } from "../../global/chart/shader/shaderEvents.ts";
import type { ShaderChartEvent } from "../../global/chart/shader/shaderEvents.ts";
import { registeredChartDocument } from "../../global/chart/streaming/chartDocumentRegistry.ts";

const SPECIAL_ACTIVITY_TRACKS = [
  "scaleXEvents",
  "scaleYEvents",
  "colorEvents",
  "textEvents",
] as const;

/** Minimal shape for time statistics: notes and events only need beat endpoints. */
interface BeatSpan {
  startTime: number[];
  endTime: number[];
}

/** A track's event-start seconds plus the index used for interval queries. */
export interface TrackTimes<T> {
  times: number[];
  index: IntervalIndex<T>;
}

/** Builds a beat-interval index over events. */
const trackIndex = <T extends BeatSpan>(events: readonly T[]): IntervalIndex<T> =>
  new IntervalIndex(
    events,
    (event) => beatValue(event.startTime),
    (event) => beatValue(event.endTime),
  );

/** A line's time activity: duration, note starts, base tracks and extended tracks. */
export class LineActivity {
  declare duration: number;
  declare notes: number[];
  declare noteBeats: number[];
  declare layers: TrackTimes<JudgeLineEvent>[];
  declare special: TrackTimes<JudgeLineEvent>;

  /** Collects note, layer, and extended-track times for one line. */
  constructor(line: JudgeLine, tempo: TempoSource) {
    this.duration = 0;
    /** Records each event's start time and extends the line duration. */
    const times = (events: readonly BeatSpan[]): number[] =>
      events.map((event) => {
        const start = tempo.seconds(event.startTime);
        this.duration = Math.max(this.duration, start, tempo.seconds(event.endTime));
        return start;
      });
    /** Merges several track types in one layer into a time list and index. */
    const track = (
      layer: LineEventLayer | null | undefined,
      types: readonly (keyof LineEventLayer)[],
    ): TrackTimes<JudgeLineEvent> => {
      const events = types.flatMap((type) => layer?.[type] ?? []);
      return { times: times(events), index: trackIndex(events) };
    };
    const notes = line.notes ?? [];
    this.notes = times(notes);
    this.noteBeats = notes.map((event) => beatValue(event.startTime));
    this.layers = (line.eventLayers ?? []).map((layer) => track(layer, EVENT_TYPES));
    this.special = track(line.extended, SPECIAL_ACTIVITY_TRACKS);
  }
}

/** A line's timeline activity, including its schedule, shader starts and index. */
export interface ActivityLine {
  activity: LineActivity;
  shaderTimes: number[];
  shaderIndex: IntervalIndex<ShaderChartEvent>;
  /** Latest note, event, or shader time on the line. */
  duration: number;
}

/** A layer-density histogram; `key` enables reuse across frames. */
export interface ActivityDensity {
  key: string;
  bins: number;
  noteBins: Uint32Array;
  eventBins: Uint32Array;
  maximum: number;
}

/** The state of a layer in the current viewport. */
export type LayerState = "empty" | "visible" | "outside";

/** Build one line's activity and shader directory without touching shared state. */
function activityLine(
  chart: Chart,
  line: JudgeLine,
  tempo: TempoSource,
  index: number,
): ActivityLine {
  const activity = new LineActivity(line, tempo);
  const effects = shaderEvents(chart, index);
  let duration = activity.duration;
  const shaderTimes = effects.map((event) => {
    const start = tempo.seconds(event.startTime);
    duration = Math.max(duration, start, tempo.seconds(event.endTime));
    return start;
  });
  return { activity, shaderTimes, shaderIndex: trackIndex(effects), duration };
}

/** Compiles per-line activity for a chart and answers viewport queries over it. */
export class TimelineActivity {
  declare cache: WeakMap<JudgeLine, LineActivity>;
  declare chart: Chart | null;
  declare tempo: TempoSource | null;
  declare densityCache: ActivityDensity | null;
  declare duration: number;
  declare lines: ActivityLine[];
  /** Source line snapshot the compiled entries were built from. */
  declare lineSnapshot: JudgeLine[];
  /** Paged document revision, which changes when one line materializes. */
  declare revision: number | null;

  /** Starts with an empty line cache. */
  constructor() {
    this.cache = new WeakMap();
    this.lines = [];
    this.lineSnapshot = [];
    this.revision = null;
    this.duration = 1;
  }

  /**
   * Rebuild line activity when the chart, tempo, or paged line graph changes.
   *
   * A paged document keeps one facade chart object and mutates only the line it
   * materialized. Comparing the document revision lets the patch path refresh
   * just that entry instead of rebuilding the whole overview strip.
   */
  compile(chart: Chart, tempo: TempoSource): void {
    const document = registeredChartDocument(chart);
    const revision = document?.contentRevision ?? null;
    if (this.chart === chart && this.tempo === tempo && this.revision === revision) {
      return;
    }
    const tempoChanged = this.tempo !== tempo;
    const sourceLines = chart.judgeLineList ?? [];
    const canPatch =
      !tempoChanged &&
      this.chart === chart &&
      this.lines.length === sourceLines.length &&
      this.lineSnapshot.length === sourceLines.length;
    if (tempoChanged) {
      this.cache = new WeakMap();
    }
    this.chart = chart;
    this.tempo = tempo;
    this.revision = revision;
    this.densityCache = null;
    if (canPatch) {
      for (let index = 0; index < sourceLines.length; index += 1) {
        const line = sourceLines[index];
        if (line === this.lineSnapshot[index]) {
          continue;
        }
        this.lines[index] = activityLine(chart, line, tempo, index);
      }
      this.lineSnapshot = [...sourceLines];
    } else {
      this.lineSnapshot = [...sourceLines];
      this.lines = sourceLines.map((line, index) => {
        const activity = this.cache.get(line);
        if (!activity) {
          const built = activityLine(chart, line, tempo, index);
          this.cache.set(line, built.activity);
          return built;
        }
        const effects = shaderEvents(chart, index);
        let duration = activity.duration;
        const shaderTimes = effects.map((event) => {
          const start = tempo.seconds(event.startTime);
          duration = Math.max(duration, start, tempo.seconds(event.endTime));
          return start;
        });
        return { activity, shaderTimes, shaderIndex: trackIndex(effects), duration };
      });
    }
    let duration = 1;
    for (const line of this.lines) {
      duration = Math.max(duration, line.duration);
    }
    // An unloaded line has no activity yet, but its index summary already knows
    // where it ends. The overview must not shrink to the loaded prefix while
    // the scheduler fills the rest.
    for (const summary of document?.index?.lines ?? []) {
      if (summary.endSeconds !== null) {
        duration = Math.max(duration, summary.endSeconds);
      }
    }
    this.duration = duration;
  }

  /** Builds or reuses the note and event histogram for one timeline strip. */
  density(
    lineIndex: number,
    layer: number,
    extended: boolean,
    duration: number,
    height: number,
  ): ActivityDensity {
    const bins = Math.max(96, Math.min(900, Math.max(Math.round(height), Math.ceil(duration * 8))));
    const key = `${lineIndex}:${layer}:${extended}:${duration}:${bins}`;
    const cached = this.densityCache;
    if (cached && cached.key === key) {
      return cached;
    }
    const noteBins = new Uint32Array(bins);
    const eventBins = new Uint32Array(bins);
    /** Bins the given event start times into the target histogram. */
    const add = (target: Uint32Array, times: readonly number[] | undefined): void => {
      for (const seconds of times ?? []) {
        target[Math.max(0, Math.min(bins - 1, Math.floor((seconds / duration) * bins)))]++;
      }
    };
    const line = this.lines[lineIndex];
    if (line) {
      // Notes are counted in chart-beat buckets, then projected onto the
      // time-aligned strip at the first note in each bucket. This keeps the
      // meaning of density stable when BPM changes, while the strip remains
      // directly comparable with the playhead and event histogram.
      const noteCounts = new Map<number, { count: number; seconds: number }>();
      line.activity.noteBeats.forEach((beat, index) => {
        const bucket = Math.floor(beat);
        const current = noteCounts.get(bucket);
        if (current) {
          current.count++;
        } else {
          noteCounts.set(bucket, { count: 1, seconds: line.activity.notes[index] });
        }
      });
      for (const { count, seconds } of noteCounts.values()) {
        const bin = Math.max(0, Math.min(bins - 1, Math.floor((seconds / duration) * bins)));
        noteBins[bin] += count;
      }
    }
    add(eventBins, extended ? line?.activity.special.times : line?.activity.layers[layer]?.times);
    if (extended) {
      add(eventBins, line?.shaderTimes);
    }
    this.densityCache = {
      key,
      bins,
      noteBins,
      eventBins,
      maximum: Math.max(1, ...noteBins, ...eventBins),
    };
    return this.densityCache;
  }

  /** Classifies a layer as empty, visible in the range, or outside it. */
  layerState(
    lineIndex: number,
    layer: number,
    extended: boolean,
    start: number,
    end: number,
    shaderStart: number,
    shaderEnd: number,
  ): LayerState {
    const line = this.lines[lineIndex];
    const index = extended ? line?.activity.special.index : line?.activity.layers[layer]?.index;
    const shaders = extended ? line?.shaderIndex : null;
    if (!index?.size && !shaders?.size) {
      return "empty";
    }
    return index?.has(start, end) || shaders?.has(shaderStart, shaderEnd) ? "visible" : "outside";
  }
}
