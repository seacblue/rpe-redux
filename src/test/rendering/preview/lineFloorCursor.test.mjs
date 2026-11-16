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

/** Constant speed layers should fold into one line-level rate without changing distance. */
test("line floor cursor folds constant speed layers", () => {
  const tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }]);
  const speeds = [
    new SpeedIntegral([createEvent(2, 2, 0, 1), createEvent(2, 2, 1, 3)], tempo),
    new SpeedIntegral([createEvent(1, 3, 0, 2)], tempo),
  ];
  const cursor = new LineFloorCursor(speeds);
  for (const seconds of [-1, 0, 0.5, 2, 4]) {
    const expected = speeds.reduce((sum, speed) => sum + speed.distance(seconds), 0);
    assert.equal(cursor.value(seconds), expected, `constant fold mismatch at ${seconds}s`);
  }
  assert.equal(speeds[0].constantSpeed, 2);
  assert.equal(speeds[1].constantSpeed, null);
});

/** Flat speed events use their start beat as a step boundary, even when the span is long. */
test("line floor cursor keeps long flat speed steps exact", () => {
  const tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }]);
  const speed = new SpeedIntegral(
    [createEvent(1, 1, 0, 2), createEvent(2, 2, 4, 6), createEvent(0.5, 0.5, 8, 10)],
    tempo,
  );
  const cursor = new LineFloorCursor([speed]);
  const expectedDistance = (seconds) => {
    if (seconds <= 0) {
      return 0;
    }
    if (seconds <= 2) {
      return seconds * 120;
    }
    if (seconds <= 4) {
      return (2 + (seconds - 2) * 2) * 120;
    }
    return (6 + (seconds - 4) * 0.5) * 120;
  };

  for (const seconds of [0, 0.25, 1.99, 2, 3.5, 4, 5.5, 8, 9.5, 12]) {
    assert.equal(cursor.value(seconds), expectedDistance(seconds), `step mismatch at ${seconds}s`);
  }
  assert.equal(speed.stepSpeed, true);
});

/** Redundant flat speed tails should not create extra integral segments. */
test("line floor cursor folds a repeated non-overlapping speed tail", () => {
  const tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }]);
  const speed = new SpeedIntegral(
    [createEvent(1, 1, 0, 2), createEvent(1, 1, 2, 8), createEvent(2, 2, 8, 10)],
    tempo,
  );

  assert.equal(speed.sources.length, 2);
  assert.equal(speed.distance(2.5), 2.5 * 120);
  assert.equal(speed.distance(5), 6 * 120);
});
