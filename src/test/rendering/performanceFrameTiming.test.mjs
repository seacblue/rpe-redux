/** Tests bounded editor paint timing storage used by the performance HUD. */

import assert from "node:assert/strict";
import test from "node:test";
import {
  performanceFrameTimingSnapshot,
  recordPerformanceFrameTiming,
  resetPerformanceFrameTiming,
} from "../../frontend/overlays/performance/performanceFrameTiming.ts";

test("frame timing keeps the latest bounded Timeline and Preview samples", () => {
  resetPerformanceFrameTiming();
  recordPerformanceFrameTiming({ timelineMs: 12, previewMs: 4, totalMs: 18 });

  assert.deepEqual(performanceFrameTimingSnapshot(), {
    timelineMs: 12,
    previewMs: 4,
    totalMs: 18,
    timelineSamples: [12],
    previewSamples: [4],
    totalSamples: [18],
  });
});

test("frame timing drops invalid durations and bounds its history", () => {
  resetPerformanceFrameTiming();
  for (let index = 0; index < 65; index += 1) {
    recordPerformanceFrameTiming({
      timelineMs: index === 64 ? Number.NaN : index,
      previewMs: index === 63 ? -1 : index,
      totalMs: index === 62 ? Number.POSITIVE_INFINITY : index,
    });
  }

  const snapshot = performanceFrameTimingSnapshot();
  assert.equal(snapshot.timelineSamples.length, 60);
  assert.equal(snapshot.previewSamples.length, 60);
  assert.equal(snapshot.totalSamples.length, 60);
  assert.equal(snapshot.timelineMs, 0);
  assert.equal(snapshot.previewMs, 64);
  assert.equal(snapshot.totalMs, 64);
  assert.equal(snapshot.timelineSamples[0], 5);
  assert.equal(snapshot.previewSamples[0], 5);
  assert.equal(snapshot.totalSamples[0], 5);
});
