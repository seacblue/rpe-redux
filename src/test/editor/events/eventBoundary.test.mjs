/** Step events own the sample exactly at their start, matching RPE's bisect_right. */
import assert from "node:assert/strict";
import test from "node:test";
import { EventTrack } from "../../../core/global/chart/timing/events.ts";

const tempo = { seconds: (beat) => Number(beat) };

function track() {
  return new EventTrack(
    [
      { startTime: 0, endTime: 1, start: 0, end: 0, easingType: 1 },
      { startTime: 1, endTime: 2, start: 90, end: 90, easingType: 1 },
      { startTime: 2, endTime: 3, start: 180, end: 180, easingType: 1 },
    ],
    tempo,
  );
}

test("a step event is sampled at its exact start time", () => {
  assert.equal(track().value(0.999), 0);
  assert.equal(track().value(1), 90);
  assert.equal(track().value(2), 180);
});

test("forward and backward seeks include the boundary event", () => {
  const forward = track();
  forward.value(0.5);
  assert.equal(forward.value(1), 90);

  const backward = track();
  backward.value(2.5);
  assert.equal(backward.value(1), 90);
});

test("a reversed event range is ignored by the runtime track", () => {
  const reversed = new EventTrack(
    [
      { startTime: 3, endTime: 1, start: 10, end: 20, easingType: 1 },
      { startTime: 4, endTime: 5, start: 30, end: 40, easingType: 1 },
    ],
    tempo,
  );

  assert.deepEqual(
    reversed.events.map((entry) => entry.event.start),
    [30],
    "reversed events never enter the runtime sampling track",
  );
});

test("a future flat event is not folded when its fallback differs", () => {
  const future = new EventTrack(
    [{ startTime: 4, endTime: 4, start: 5, end: 5, easingType: 1 }],
    tempo,
    1,
    0,
  );

  assert.equal(future.constantValue(), null);
  assert.equal(future.value(0), 0);
  assert.equal(future.value(4), 5);
});

test("an equal-endpoint trajectory is not treated as constant", () => {
  const trajectory = new EventTrack(
    [
      {
        startTime: 0,
        endTime: 4,
        start: 0,
        end: 0,
        easingType: 1,
        trajectory: {},
      },
    ],
    tempo,
  );

  assert.equal(trajectory.constantValue(), null);
  assert.notEqual(trajectory.value(0.5), trajectory.value(1.5));
});
