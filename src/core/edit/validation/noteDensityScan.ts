/**
 * Estimates how many notes share the screen at once, for compatibility warnings.
 *
 * The renderer decides visibility from the sampled judgement-line floor, so a
 * note is on screen while its floor distance is inside the preview radius. Speed
 * events are integrated into that floor, which turns the bound into a time
 * interval: the interval's start depends on the sampled line rate at the note
 * and on the note's own constant speed multiplier. The estimate is deliberately
 * conservative — wider intervals and a generous radius — because missing a dense
 * passage is worse than reporting one the target simulator handles.
 *
 * This module is pure chart math: no React, no host access, so a worker can run
 * it on a plain chart snapshot.
 */
import type { Chart, JudgeLine } from "../../global/chart/chart.ts";
import { fromNumber, type Beat } from "../../global/chart/timing/beat.ts";
import { SpeedIntegral } from "../../global/chart/timing/events.ts";
import { TempoMap } from "../../global/chart/timing/tempo.ts";

/** Everything the density estimate needs; values come from the settings page. */
export interface NoteDensityOptions {
  /** Same-time note count that starts a warning. */
  caution: number;
  /** Screen radius used as the visible floor distance. */
  radius: number;
  /** Sampling resolution of the diff array, in chart seconds. */
  bucketSeconds: number;
  /** Weight of one Hold body relative to a tap head. */
  holdWeight: number;
  /** Whether fake notes count; the preview still draws them. */
  includeFake: boolean;
  /** Longest look-back a note may contribute, in chart seconds. */
  maxLookbackSeconds: number;
  /** Cap on reported ranges, so a pathological chart cannot flood the panel. */
  maxIssues: number;
}

/** One dense passage, in both chart seconds and beats. */
export interface NoteDensityRange {
  startSeconds: number;
  endSeconds: number;
  startTime: Beat;
  endTime: Beat;
  peak: number;
  /** Line indices that contribute notes inside the range, highest first. */
  lines: readonly number[];
}

/** The whole estimate for one chart. */
export interface NoteDensityScan {
  /** Highest windowed note count, rounded down. */
  peak: number;
  ranges: readonly NoteDensityRange[];
}

/** Default options used before the settings page has been read. */
export const DEFAULT_NOTE_DENSITY_OPTIONS: NoteDensityOptions = Object.freeze({
  caution: 100,
  radius: 900,
  bucketSeconds: 0.05,
  holdWeight: 1,
  includeFake: true,
  maxLookbackSeconds: 30,
  maxIssues: 40,
});

/** One note's estimated on-screen interval, in chart seconds. */
interface DensityInterval {
  lineIndex: number;
  start: number;
  end: number;
  weight: number;
}

/** A rate below this is treated as a stationary line. */
const RATE_EPSILON = 1e-6;
/** The preview's own default radius; the estimate never goes below it. */
const MIN_RADIUS = 1;

/** Estimate the same-time note peak and its dense ranges for one chart. */
export function scanNoteDensity(chart: Chart, options: NoteDensityOptions): NoteDensityScan {
  const empty: NoteDensityScan = { peak: 0, ranges: [] };
  const entries = Array.isArray(chart.BPMList) ? chart.BPMList : [];
  if (!entries.length) {
    return empty;
  }
  let tempo: TempoMap;
  try {
    tempo = new TempoMap(entries);
  } catch {
    return empty;
  }
  const lines = Array.isArray(chart.judgeLineList) ? chart.judgeLineList : [];
  const intervals: DensityInterval[] = [];
  let latest = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) {
      continue;
    }
    const rateAt = lineRateSampler(line, tempo);
    const notes = Array.isArray(line.notes) ? line.notes : [];
    for (const note of notes) {
      const interval = noteVisibilityInterval(note, rateAt, tempo, options);
      if (!interval) {
        continue;
      }
      interval.lineIndex = lineIndex;
      intervals.push(interval);
      latest = Math.max(latest, interval.end);
    }
  }
  if (!intervals.length) {
    return empty;
  }
  const bucket = Math.max(0.005, options.bucketSeconds);
  const length = Math.max(1, Math.ceil(latest / bucket) + 2);
  const diff = new Float64Array(length + 1);
  for (const interval of intervals) {
    const first = clampIndex(Math.floor(interval.start / bucket), length + 1);
    const last = clampIndex(Math.ceil(interval.end / bucket), length + 1);
    diff[first] += interval.weight;
    diff[last + 1] -= interval.weight;
  }
  // The prefix sum turns the diff array into the same-time count per bucket.
  const counts = new Float64Array(length);
  let running = 0;
  let peak = 0;
  for (let index = 0; index < length; index += 1) {
    running += diff[index];
    counts[index] = running;
    if (running > peak) {
      peak = running;
    }
  }
  return {
    peak: Math.floor(peak + 1e-6),
    ranges: collectRanges(counts, bucket, tempo, intervals, options),
  };
}

/** Clamp one bucket index into a typed array of `length` entries. */
function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(0, value), length - 1);
}

/**
 * Compile the line's speed layers into one sampled rate function.
 *
 * Only `speedEvents` change the floor, so the other eleven tracks are never
 * compiled here. A line without speed events is stationary.
 */
function lineRateSampler(line: JudgeLine, tempo: TempoMap): (seconds: number) => number {
  const layers = Array.isArray(line.eventLayers) ? line.eventLayers.slice(0, 5) : [];
  const integrals: SpeedIntegral[] = [];
  for (const layer of layers) {
    const events = layer?.speedEvents;
    if (!events?.length) {
      continue;
    }
    integrals.push(new SpeedIntegral(events, tempo));
  }
  if (!integrals.length) {
    return () => 0;
  }
  return (seconds: number) => {
    let rate = 0;
    for (const integral of integrals) {
      const value = integral.value(seconds);
      if (Number.isFinite(value)) {
        rate += value * 120;
      }
    }
    return rate;
  };
}

/**
 * The interval during which one note's floor distance stays inside the radius.
 *
 * The look-back is the note's visible time clipped by the sampled line rate. A
 * stationary line or a zero-speed note keeps the whole visible gate, which is
 * exactly when the renderer falls back to its time index.
 */
function noteVisibilityInterval(
  note: {
    speed?: number;
    visibleTime?: number;
    type?: number;
    isFake?: number;
    startTime?: readonly number[];
    endTime?: readonly number[];
  },
  rateAt: (seconds: number) => number,
  tempo: TempoMap,
  options: NoteDensityOptions,
): DensityInterval | null {
  if (!Array.isArray(note.startTime) || !Array.isArray(note.endTime)) {
    return null;
  }
  if (options.includeFake === false && Number(note.isFake) === 1) {
    return null;
  }
  const weight = Number(note.type) === 2 ? Math.max(0, options.holdWeight) : 1;
  if (weight <= 0) {
    return null;
  }
  let start: number;
  let end: number;
  try {
    start = tempo.seconds(note.startTime);
    end = tempo.seconds(note.endTime);
  } catch {
    return null;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  const multiplier = Math.abs(Number(note.speed ?? 1));
  const visibleTime = Number(note.visibleTime ?? 999999);
  const gate = Number.isFinite(visibleTime) ? Math.max(0, visibleTime) : options.maxLookbackSeconds;
  const lookback = Math.min(gate, options.maxLookbackSeconds);
  const radius = Math.max(MIN_RADIUS, options.radius);
  const rate = Math.abs(rateAt(start));
  let preRoll: number;
  if (!Number.isFinite(multiplier) || multiplier <= 0 || rate <= RATE_EPSILON) {
    preRoll = lookback;
  } else {
    preRoll = Math.min(lookback, radius / (multiplier * rate));
  }
  return { lineIndex: 0, start: start - preRoll, end, weight };
}

/**
 * Group the per-bucket same-time counts into dense ranges above `caution`.
 *
 * `counts[index]` is how many notes share the screen at that bucket, so a range
 * is a stretch where that number stays above the threshold. Each range keeps its
 * peak and the lines that actually contribute notes inside it, so a reader can
 * jump straight to the line that made the passage dense.
 */
function collectRanges(
  counts: Float64Array,
  bucket: number,
  tempo: TempoMap,
  intervals: readonly DensityInterval[],
  options: NoteDensityOptions,
): NoteDensityRange[] {
  const ranges: NoteDensityRange[] = [];
  const caution = Math.max(0, options.caution);
  let index = 0;
  while (index < counts.length && ranges.length < options.maxIssues) {
    if (counts[index] <= caution) {
      index += 1;
      continue;
    }
    const from = index;
    let peak = counts[index];
    while (index + 1 < counts.length && counts[index + 1] > caution) {
      index += 1;
      peak = Math.max(peak, counts[index]);
    }
    const startSeconds = from * bucket;
    const endSeconds = Math.max(startSeconds + bucket, (index + 1) * bucket);
    ranges.push({
      startSeconds,
      endSeconds,
      startTime: beatAtSeconds(tempo, startSeconds),
      endTime: beatAtSeconds(tempo, endSeconds),
      peak: Math.floor(peak + 1e-6),
      lines: dominantLines(intervals, startSeconds, endSeconds),
    });
    index += 1;
  }
  return ranges;
}

/** Return the lines holding the most notes inside one dense range. */
function dominantLines(
  intervals: readonly DensityInterval[],
  startSeconds: number,
  endSeconds: number,
): readonly number[] {
  const totals = new Map<number, number>();
  for (const interval of intervals) {
    // A zero-length note (a tap) has `start === end`, so the range has to be
    // treated as closed; otherwise a dense stack of taps reports no lines.
    if (interval.start > endSeconds || interval.end < startSeconds) {
      continue;
    }
    totals.set(interval.lineIndex, (totals.get(interval.lineIndex) ?? 0) + interval.weight);
  }
  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, 5)
    .map(([lineIndex]) => lineIndex);
}

/** Convert one chart second to a beat triple, falling back to beat zero. */
export function beatAtSeconds(tempo: TempoMap, seconds: number): Beat {
  try {
    return fromNumber(tempo.beat(seconds));
  } catch {
    return [0, 0, 1];
  }
}
