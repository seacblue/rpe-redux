/** Stores per-surface editor paint timings for the performance HUD. */

/** One synchronous paint sample reported by the editor frame renderer. */
export interface PerformanceFrameTimingSample {
  readonly timelineMs: number;
  readonly previewMs: number;
  readonly totalMs: number;
}

/** The latest paint sample. */
export interface PerformanceFrameTimingSnapshot extends PerformanceFrameTimingSample {}

/** Mutable module state; snapshots hand out a copy so callers cannot alias it. */
interface FrameTimingState {
  timelineMs: number;
  previewMs: number;
  totalMs: number;
}

let state: FrameTimingState = emptyState();

/** Return fresh zeroed state. */
function emptyState(): FrameTimingState {
  return {
    timelineMs: 0,
    previewMs: 0,
    totalMs: 0,
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
}

/** Return a detached timing snapshot safe for HUD and window relays. */
export function performanceFrameTimingSnapshot(): PerformanceFrameTimingSnapshot {
  return {
    timelineMs: state.timelineMs,
    previewMs: state.previewMs,
    totalMs: state.totalMs,
  };
}

/** Reset frame timing between deterministic diagnostics runs. */
export function resetPerformanceFrameTiming(): void {
  state = emptyState();
}
