/** Verifies performance-HUD metrics use the configured frame budget. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  frameBudgetMs,
  frameIntervalLoadPercent,
  renderLoadPercent,
} from "../../frontend/overlays/performance/performanceHudMetrics.ts";

test("render load is measured against the configured 144 Hz budget", () => {
  assert.ok(Math.abs(frameBudgetMs(144) - 1000 / 144) < 1e-12);
  assert.ok(Math.abs(renderLoadPercent(11.25, 144) - 162) < 1e-12);
  assert.equal(renderLoadPercent(11.25, 144) > 100, true);
});

test("frame interval load reports a missed 144 Hz cadence", () => {
  assert.equal(frameIntervalLoadPercent(1000 / 144, 144), 100);
  assert.equal(frameIntervalLoadPercent(16.6666666667, 144) > 200, true);
});
