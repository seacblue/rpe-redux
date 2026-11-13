/** Stores bounded per-surface editor paint timings for the performance HUD. */
import { appendBoundedSample } from "./performanceHudMetrics.ts";

/** One synchronous paint sample reported by the editor frame renderer. */
export interface PerformanceFrameTimingSample {
  readonly timelineMs: number;
  readonly previewMs: number;
  readonly totalMs: number;
}

/** The latest paint sample and its bounded history. */
export interface PerformanceFrameTimingSnapshot extends PerformanceFrameTimingSample {
  readonly timelineSamples: readonly number[];
  readonly previewSamples: readonly number[];
  readonly totalSamples: readonly number[];
}

/** Mutable module state; snapshots hand out copies so callers cannot alias it. */
interface FrameTimingState {
  timelineMs: number;
  previewMs: number;
  totalMs: number;
  timelineSamples: number[];
  previewSamples: number[];
  totalSamples: number[];
}

let state: FrameTimingState = emptyState();

/** Return fresh zeroed state with empty sample windows. */
function emptyState(): FrameTimingState {
  return {
    timelineMs: 0,
    previewMs: 0,
    totalMs: 0,
    timelineSamples: [],
    previewSamples: [],
    totalSamples: [],
  };
}

/** Clamp an untrusted renderer duration to a finite non-negative value. */
function safeDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(value, 60_000) : 0;
}

/** Record one editor paint sample without retaining renderer-owned objects. */
export function recordPerformanceFrameTiming(sample: PerformanceFrameTimingSample): void {
  state.timelineMs = safeDuration(sample.timelineMs);
  state.previewMs = safeDuration(sample.previewMs);
  state.totalMs = safeDuration(sample.totalMs);
  appendBoundedSample(state.timelineSamples, state.timelineMs);
  appendBoundedSample(state.previewSamples, state.previewMs);
  appendBoundedSample(state.totalSamples, state.totalMs);
}

/** Return a detached timing snapshot safe for HUD and window relays. */
export function performanceFrameTimingSnapshot(): PerformanceFrameTimingSnapshot {
  return {
    timelineMs: state.timelineMs,
    previewMs: state.previewMs,
    totalMs: state.totalMs,
    timelineSamples: [...state.timelineSamples],
    previewSamples: [...state.previewSamples],
    totalSamples: [...state.totalSamples],
  };
}

/** Reset frame timing between deterministic diagnostics runs. */
export function resetPerformanceFrameTiming(): void {
  state = emptyState();
}
