/**
 * Step events own the sample exactly at their start, matching RPE's bisect_right,
 * and the first event's curve extends across the prefix before it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EventTrack,
  eventTrackSamplingStats,
  resetEventTrackSamplingStats,
} from "../../../core/global/chart/timing/events.ts";

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

test("reverse playback walks the primed event cursor instead of re-searching every frame", () => {
  const events = Array.from({ length: 128 }, (_, index) => ({
    startTime: index,
    endTime: index + 0.5,
    start: index,
    end: index + 1,
    easingType: 1,
  }));
  const reversed = new EventTrack(events, tempo);
  reversed.value(100.25);
  resetEventTrackSamplingStats();
  for (let seconds = 100; seconds >= 0; seconds -= 0.25) {
    const value = reversed.value(seconds);
    assert.ok(Number.isFinite(value));
  }
  const stats = eventTrackSamplingStats();
  assert.ok(stats.cursorHits > stats.cursorMisses, JSON.stringify(stats));
});

test("a large forward jump keeps the active event exact", () => {
  const events = Array.from({ length: 256 }, (_, index) => ({
    startTime: index,
    endTime: index + 0.5,
    start: index,
    end: index + 1,
    easingType: 1,
  }));
  const jumped = new EventTrack(events, tempo);

  jumped.value(0.25);
  assert.equal(jumped.value(200.25), 200.5);
  assert.equal(jumped.value(255), 255);
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

test("a flat event extends its value across the prefix", () => {
  const future = new EventTrack(
    [{ startTime: 4, endTime: 4, start: 5, end: 5, easingType: 1 }],
    tempo,
    1,
    0,
  );

  assert.equal(future.constantValue(), 5);
  assert.equal(future.value(0), 5);
  assert.equal(future.value(4), 5);
});

test("the first event's curve extends left of its own start", () => {
  // Quad in is `progress ** 2`, so 0 -> 300 across beats 3-4 continues as
  // 300 * (beat - 3) ** 2 to the left of beat 3.
  const quadIn = new EventTrack(
    [{ startTime: 3, endTime: 4, start: 0, end: 300, easingType: 5 }],
    tempo,
  );

  assert.equal(quadIn.value(3), 0);
  assert.equal(quadIn.value(4), 300);
  assert.equal(quadIn.value(2), 300);
  assert.equal(quadIn.value(0), 2700);
});

test("the extension also covers negative beats", () => {
  const quadIn = new EventTrack(
    [{ startTime: 3, endTime: 4, start: 0, end: 300, easingType: 5 }],
    tempo,
  );
  assert.equal(quadIn.value(-2), 7500);

  const fromZero = new EventTrack(
    [{ startTime: 0, endTime: 4, start: 0, end: 400, easingType: 5 }],
    tempo,
  );
  assert.equal(fromZero.value(0), 0);
  assert.equal(fromZero.value(-2), 100);
});

test("a padding event at beat zero ends the extension", () => {
  const padded = new EventTrack(
    [
      { startTime: 0, endTime: 0, start: 0, end: 0, easingType: 1 },
      { startTime: 3, endTime: 4, start: 0, end: 300, easingType: 5 },
    ],
    tempo,
  );

  assert.equal(padded.value(-1), 0);
  assert.equal(padded.value(0), 0);
  assert.equal(padded.value(3), 0);
  assert.equal(padded.value(4), 300);
});

test("the gap between two events is not extended", () => {
  const gapped = new EventTrack(
    [
      { startTime: 0, endTime: 1, start: 0, end: 10, easingType: 5 },
      { startTime: 3, endTime: 4, start: 100, end: 200, easingType: 5 },
    ],
    tempo,
  );

  assert.equal(gapped.value(2), 10, "the earlier event holds its end value");
});

test("a bezier first event extends its prefix along the start tangent", () => {
  const eased = new EventTrack(
    [
      {
        startTime: 3,
        endTime: 4,
        start: 0,
        end: 300,
        easingType: 1,
        bezier: 1,
        bezierPoints: [0.25, 0.1, 0.25, 1],
      },
    ],
    tempo,
  );

  assert.equal(eased.value(3), 0);
  assert.equal(eased.value(4), 300);
  // The start handle (0.25, 0.1) gives a slope of 0.4, so one span to the left is
  // 300 * -0.4 rather than the whole 300 of the chord.
  assert.ok(Math.abs(eased.value(2) - -120) < 1e-9);
  assert.ok(Math.abs(eased.value(0) - -360) < 1e-9);

  const flatStart = new EventTrack(
    [
      {
        startTime: 3,
        endTime: 4,
        start: 0,
        end: 300,
        easingType: 1,
        bezier: 1,
        bezierPoints: [0.5, 0, 0.5, 1],
      },
    ],
    tempo,
  );
  // A zero-height first handle leaves the curve flat at its start, so the prefix
  // holds the start value instead of moving.
  assert.equal(flatStart.value(0), 0);
  assert.equal(flatStart.value(2), 0);
});

test("a hooked first event sets the initial value to its own value", () => {
  // A hooked event locks its value pair, so its prefix holds that value instead of
  // continuing any curve, even when the stored span carries a duration.
  const hooked = new EventTrack(
    [{ startTime: 3, endTime: 3, start: 40, end: 40, easingType: 5, inst: 1 }],
    tempo,
  );
  assert.equal(hooked.value(-2), 40);
  assert.equal(hooked.value(0), 40);
  assert.equal(hooked.value(3), 40);

  const spanned = new EventTrack(
    [{ startTime: 3, endTime: 4, start: 40, end: 300, easingType: 5, inst: 1 }],
    tempo,
  );
  assert.equal(spanned.value(0), 40, "the locked value owns the prefix, not the curve");
  assert.equal(spanned.value(-2), 40);
});

test("a trajectory first event holds its start value across the prefix", () => {
  const path = new EventTrack(
    [{ startTime: 3, endTime: 4, start: 10, end: 10, easingType: 1, trajectory: {} }],
    tempo,
  );

  assert.equal(path.value(0), 10);
  assert.equal(path.value(-3), 10);
});

test("an empty track keeps its fallback at every time", () => {
  const empty = new EventTrack([], tempo, 7);

  assert.equal(empty.value(0), 7);
  assert.equal(empty.value(-3), 7);
});

test("a numeric track keeps its final value after the last event", () => {
  const final = new EventTrack(
    [
      { startTime: 1, endTime: 2, start: 10, end: 20, easingType: 1 },
      { startTime: 3, endTime: 4, start: 30, end: 40, easingType: 1 },
    ],
    tempo,
  );

  assert.equal(final.value(4), 40);
  assert.equal(final.value(40), 40);
});

test("adjacent flat events with the same value keep only their head event", () => {
  const compacted = new EventTrack(
    [
      { startTime: 0, endTime: 0, start: 5, end: 5, easingType: 1 },
      { startTime: 4, endTime: 8, start: 5, end: 5, easingType: 2 },
      { startTime: 9, endTime: 9, start: 7, end: 7, easingType: 1 },
    ],
    tempo,
  );

  assert.deepEqual(
    compacted.events.map(({ event }) => event.startTime),
    [0, 9],
    "the later flat event is redundant even when its authored duration is long",
  );
  assert.equal(compacted.value(8), 5);
  assert.equal(compacted.value(9), 7);
});

test("a non-overlapping flat tail is folded into the previous event", () => {
  const compacted = new EventTrack(
    [
      { startTime: 0, endTime: 4, start: 0, end: 5, easingType: 1 },
      { startTime: 4, endTime: 12, start: 5, end: 5, easingType: 1 },
      { startTime: 12, endTime: 12, start: 7, end: 7, easingType: 1 },
    ],
    tempo,
  );

  assert.deepEqual(
    compacted.events.map(({ event }) => event.startTime),
    [0, 12],
    "a flat tail that repeats the previous end value has no new change point",
  );
  assert.equal(compacted.value(8), 5);
  assert.equal(compacted.value(12), 7);
});

test("an overlapping flat event remains a change point", () => {
  const overlapping = new EventTrack(
    [
      { startTime: 0, endTime: 8, start: 0, end: 5, easingType: 1 },
      { startTime: 4, endTime: 12, start: 5, end: 5, easingType: 1 },
    ],
    tempo,
  );

  assert.deepEqual(
    overlapping.events.map(({ event }) => event.startTime),
    [0, 4],
  );
  assert.equal(overlapping.value(6), 5);
});

test("flat events with a different value remain separate change points", () => {
  const changes = new EventTrack(
    [
      { startTime: 0, endTime: 0, start: 5, end: 5, easingType: 1 },
      { startTime: 4, endTime: 4, start: 6, end: 6, easingType: 1 },
      { startTime: 8, endTime: 8, start: 5, end: 5, easingType: 1 },
    ],
    tempo,
  );

  assert.deepEqual(
    changes.events.map(({ event }) => event.startTime),
    [0, 4, 8],
  );
  assert.deepEqual([changes.value(3.9), changes.value(4), changes.value(8)], [5, 6, 5]);
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
