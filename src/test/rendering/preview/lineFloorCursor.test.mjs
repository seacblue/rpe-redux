/** Verifies the exact line-floor cursor across playback and seek paths. */
import assert from "node:assert/strict";
import test from "node:test";
import { createEvent } from "../../../core/global/chart/chart.ts";
import { LineFloorCursor } from "../../../core/global/chart/runtime/lineFloorCursor.ts";
import { SpeedIntegral } from "../../../core/global/chart/timing/events.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";

/** Compare cursor results with the uncached exact sum of every speed layer. */
test("line floor cursor stays exact across forward, boundary, seek, and reverse samples", () => {
  const tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }]);
  const speeds = [
    new SpeedIntegral([createEvent(-2, -1, 0, 2), createEvent(-1, 2, 2, 4)], tempo),
    new SpeedIntegral([createEvent(1, 3, 0, 3), createEvent(3, 3, 3, 5)], tempo),
  ];
  const cursor = new LineFloorCursor(speeds);
  const samples = [0, 0.1, 0.5, 1, 1.01, 2, 2.01, 3, 3.01, 4, 4.5, 2.5, 0, 5];

  for (const seconds of samples) {
    const expected = speeds.reduce((sum, speed) => sum + speed.distance(seconds), 0);
    assert.equal(cursor.value(seconds), expected, `floor mismatch at ${seconds}s`);
    assert.equal(cursor.value(seconds), expected, `repeat mismatch at ${seconds}s`);
  }

  const emptyCursor = new LineFloorCursor([new SpeedIntegral([], tempo)]);
  assert.equal(emptyCursor.value(-1), 0);
  assert.equal(emptyCursor.value(1), 0);
});
