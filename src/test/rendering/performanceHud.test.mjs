/**
 * Contracts for the performance HUD: the frame-budget math and the bounded
 * sample store the HUD reads. Both are presentation-side, so they stay unit
 * tests instead of smoke journeys.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  frameBudgetMs,
  frameIntervalLoadPercent,
  renderLoadPercent,
} from "../../frontend/overlays/performance/performanceHudMetrics.ts";
import {
  performanceFrameTimingSnapshot,
  recordPerformanceFrameTiming,
  resetPerformanceFrameTiming,
} from "../../frontend/overlays/performance/performanceFrameTiming.ts";

test("render load is measured against the configured frame budget", () => {
  assert.ok(Math.abs(frameBudgetMs(144) - 1000 / 144) < 1e-12);
  assert.ok(Math.abs(renderLoadPercent(11.25, 144) - 162) < 1e-12);
  assert.equal(renderLoadPercent(11.25, 144) > 100, true);
});

test("frame interval load reports a missed 144 Hz cadence", () => {
  assert.equal(frameIntervalLoadPercent(1000 / 144, 144), 100);
  assert.equal(frameIntervalLoadPercent(16.6666666667, 144) > 200, true);
});

test("frame timing keeps the latest Timeline and Preview values", () => {
  resetPerformanceFrameTiming();
  recordPerformanceFrameTiming({ timelineMs: 12, previewMs: 4, totalMs: 18 });

  assert.deepEqual(performanceFrameTimingSnapshot(), {
    timelineMs: 12,
    previewMs: 4,
    totalMs: 18,
  });
});

test("frame timing drops invalid durations", () => {
  resetPerformanceFrameTiming();
  recordPerformanceFrameTiming({ timelineMs: Number.NaN, previewMs: -1, totalMs: 12 });
  let snapshot = performanceFrameTimingSnapshot();
  assert.equal(snapshot.timelineMs, 0);
  assert.equal(snapshot.previewMs, 0);
  assert.equal(snapshot.totalMs, 12);

  recordPerformanceFrameTiming({ timelineMs: 5, previewMs: 3, totalMs: Number.POSITIVE_INFINITY });
  snapshot = performanceFrameTimingSnapshot();
  assert.equal(snapshot.timelineMs, 5);
  assert.equal(snapshot.previewMs, 3);
  assert.equal(snapshot.totalMs, 0);
});
