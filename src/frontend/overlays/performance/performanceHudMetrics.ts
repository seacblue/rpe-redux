/**
 * Frame-budget metrics and rolling sample windows shared by the performance HUD.
 *
 * The HUD renders one text row per instantaneous reading and one bar graph per
 * sample window, so both the metric formulas and the window size live here
 * instead of being repeated beside each graph.
 */

/** Number of samples retained by every rolling HUD graph. */
export const SAMPLE_WINDOW = 60;

/** Return the duration available to one frame at the configured refresh rate. */
export function frameBudgetMs(refreshRate: number): number {
  const safeRefreshRate = Number.isFinite(refreshRate) ? Math.max(1, refreshRate) : 60;
  return 1000 / safeRefreshRate;
}

/** Return render time as a percentage of the configured frame budget. */
export function renderLoadPercent(drawTimeMs: number, refreshRate: number): number {
  const safeDrawTime = Number.isFinite(drawTimeMs) ? Math.max(0, drawTimeMs) : 0;
  return (safeDrawTime / frameBudgetMs(refreshRate)) * 100;
}

/** Return actual frame interval as a percentage of the configured frame budget. */
export function frameIntervalLoadPercent(intervalMs: number, refreshRate: number): number {
  const safeInterval = Number.isFinite(intervalMs) ? Math.max(0, intervalMs) : 0;
  return (safeInterval / frameBudgetMs(refreshRate)) * 100;
}

/** Append one sample, dropping the oldest value once the window is full. */
export function appendBoundedSample(samples: number[], value: number): void {
  samples.push(value);
  if (samples.length > SAMPLE_WINDOW) {
    samples.shift();
  }
}
