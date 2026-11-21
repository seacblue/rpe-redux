/**
 * Regression: the picture must not jump when playback starts or stops.
 *
 * While the transport moves, the picture leads the audible position by the display
 * lead. Dropping that lead at a pause moves the playhead back by exactly that much;
 * jumping straight to it at a start moves the playhead forward while the speaker is
 * still silent. The picture clock holds the last drawn position on a pause and
 * establishes the lead over the start's output drain, and only an explicit seek
 * releases the hold.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createPictureClock } from "../../../core/edit/playback/pictureClock.ts";

/** A picture clock over a controllable transport, lead, and start drain. */
function createClock(leadSeconds = 0.052, initialDrain = 1) {
  let playing = false;
  let drain = initialDrain;
  const clock = createPictureClock({
    playing: () => playing,
    leadSeconds: () => leadSeconds,
    drainProgress: () => drain,
  });
  return {
    clock,
    play: () => {
      playing = true;
    },
    pause: () => {
      playing = false;
    },
    setDrain: (value) => {
      drain = value;
    },
  };
}

test("a moving picture leads the audible position", () => {
  const { clock, play } = createClock();

  play();
  assert.ok(Math.abs(clock.seconds(10) - 10.052) < 1e-12);
});

test("a pause holds the position the picture drew", () => {
  const { clock, play, pause } = createClock();

  play();
  assert.ok(Math.abs(clock.seconds(10) - 10.052) < 1e-12);

  pause();
  // The transport freezes a little after the last frame; the picture keeps the
  // drawn position instead of dropping the lead.
  assert.ok(Math.abs(clock.seconds(10.01) - 10.052) < 1e-12);
});

test("a resume continues from the held position", () => {
  const { clock, play, pause } = createClock();

  play();
  const held = clock.seconds(10);
  pause();
  assert.equal(clock.seconds(10), held);

  play();
  assert.equal(clock.seconds(10), held);
  assert.ok(Math.abs(clock.seconds(10.1) - (held + 0.1)) < 1e-12);
});

test("a start establishes the lead over the output drain", () => {
  const { clock, play, setDrain } = createClock(0.052, 0);

  play();
  // The first frame is painted while the first samples are still queued, so it
  // keeps the transport position instead of jumping a lead ahead.
  assert.equal(clock.seconds(10), 10);

  setDrain(0.5);
  assert.ok(Math.abs(clock.seconds(10) - 10.026) < 1e-12);

  setDrain(1);
  assert.ok(Math.abs(clock.seconds(10) - 10.052) < 1e-12);
});

test("a resume keeps the held position while the new start drains", () => {
  const { clock, play, pause, setDrain } = createClock();

  play();
  const held = clock.seconds(10);
  pause();
  assert.equal(clock.seconds(10), held);

  setDrain(0);
  play();
  assert.equal(clock.seconds(10), held);

  setDrain(1);
  assert.equal(clock.seconds(10), held);
});

test("a seek releases the held position", () => {
  const { clock, play, pause } = createClock();

  play();
  clock.seconds(10);
  pause();
  assert.ok(Math.abs(clock.seconds(10) - 10.052) < 1e-12);

  clock.release();
  assert.equal(clock.seconds(0), 0);
  assert.equal(clock.seconds(12), 12);
});

test("the picture follows the configured lead", () => {
  const { clock, play } = createClock(0.032);

  play();
  assert.ok(Math.abs(clock.seconds(4) - 4.032) < 1e-12);
});
