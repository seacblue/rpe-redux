/** Verify visual playback interpolation without changing the authoritative audio clock. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createFrameClock,
  createVisualPlaybackClock,
} from "../../../frontend/screens/editor/workspace/runtime/frame/frameClock.ts";
import { DISPLAY_LEAD_SECONDS, visualLeadSeconds } from "../../../core/media/outputLatency.ts";
import { createPictureClock } from "../../../core/edit/playback/pictureClock.ts";

/** A transport stub whose `awaitingOutput` the test controls. */
function createAudio(initial) {
  return { playing: false, time: 0, rate: 1, awaitingOutput: false, ...initial };
}

test("visual playback clock fills coarse audio samples", () => {
  const audio = createAudio();
  const clock = createVisualPlaybackClock({
    audio,
    chartSeconds: () => audio.time - 0.1,
  });

  assert.equal(clock.read(0), -0.1);

  audio.playing = true;
  audio.time = 1;
  assert.equal(clock.read(1000), 0.9);
  assert.ok(Math.abs(clock.read(1006.9) - 0.9069) < 0.000001);

  audio.time = 1.01;
  assert.ok(Math.abs(clock.read(1013.8) - 0.91) < 0.000001);
  assert.ok(Math.abs(clock.read(1020.7) - 0.9169) < 0.000001);
});

test("visual playback clock resets on pause and seek", () => {
  const audio = createAudio({ playing: true, time: 2 });
  const clock = createVisualPlaybackClock({
    audio,
    chartSeconds: () => audio.time,
  });

  assert.equal(clock.read(0), 2);
  assert.ok(Math.abs(clock.read(6.9) - 2.0069) < 0.000001);

  audio.playing = false;
  audio.time = 2.25;
  assert.equal(clock.read(20), 2.25);

  audio.playing = true;
  audio.time = 40;
  assert.equal(clock.read(100), 40);
});

test("visual playback clock does not run ahead while the start drains", () => {
  // A start holds the audible position at the start value until the output
  // latency drains. Interpolating through that window predicted a position the
  // audio was not at, and the frame after the window fell back to the sample,
  // which drew as a backwards step at every playback start.
  const audio = createAudio({ playing: true, time: 5, awaitingOutput: true });
  const clock = createVisualPlaybackClock({
    audio,
    chartSeconds: () => audio.time,
  });

  assert.equal(clock.read(0), 5);
  const frame = 1000 / 60;
  assert.equal(clock.read(frame), 5);
  assert.equal(clock.read(frame * 2), 5);
  assert.equal(clock.read(frame * 3), 5);

  // The drain completes and the sample begins to move; the first frame must move
  // forward, never back.
  audio.awaitingOutput = false;
  audio.time = 5.013;
  const first = clock.read(frame * 4);
  assert.ok(first >= 5, `first frame after the drain went backwards: ${first}`);
  assert.ok(first - 5 < frame / 1000 + 0.014, `first frame after the drain overshot: ${first}`);

  audio.time = 5.03;
  const second = clock.read(frame * 5);
  assert.ok(second > first, `second frame did not advance: ${first} -> ${second}`);
});

test("the picture is drawn ahead of the sound by the display lead", () => {
  // A frame painted now is presented one display chain later, so it has to show
  // the position the sound will have reached when it is seen.
  assert.ok(Math.abs(visualLeadSeconds() - DISPLAY_LEAD_SECONDS) < 1e-12);

  // A positive calibration moves the picture further ahead, a negative one back.
  assert.ok(Math.abs(visualLeadSeconds(0.01) - (DISPLAY_LEAD_SECONDS + 0.01)) < 1e-12);
  assert.ok(Math.abs(visualLeadSeconds(-0.02) - (DISPLAY_LEAD_SECONDS - 0.02)) < 1e-12);
});

test("the visual lead stays inside a correction-sized range", () => {
  assert.equal(visualLeadSeconds(10), 0.2);
  assert.equal(visualLeadSeconds(-10), -0.2);
  // A missing or unusable setting falls back to the calibrated default.
  assert.ok(Math.abs(visualLeadSeconds(Number.NaN) - DISPLAY_LEAD_SECONDS) < 1e-12);
  assert.ok(Math.abs(visualLeadSeconds(undefined) - DISPLAY_LEAD_SECONDS) < 1e-12);
});

test("the frame clock keeps the drawn picture when playback stops", () => {
  // The picture clock owns the display lead and the paused hold; the frame clock
  // hands it the interpolated audible position. A seek before playback reports the
  // transport position, a playing frame leads it, and a pause keeps the last drawn
  // frame instead of dropping back by the lead.
  const audio = createAudio({ playing: false, time: 0 });
  const picture = createPictureClock({
    playing: () => audio.playing,
    leadSeconds: () => DISPLAY_LEAD_SECONDS,
    drainProgress: () => 1,
  });
  const clock = createFrameClock(
    {
      audio,
      timeline: { autoScroll() {} },
      lineSwitcher: { draw() {} },
      editClock: { advance() {} },
      hitSounds: { tick() {} },
      session: () => ({}),
      tempo: () => ({ points: [{ beat: 0, secondsPerBeat: 0.5 }] }),
      chartSeconds: () => audio.time,
      drawnSeconds: (seconds) => picture.seconds(seconds),
      invalidate() {},
    },
    { atHome: () => false, hasDocument: () => true, documentHidden: () => false },
  );

  assert.equal(clock.seconds(0), 0);

  audio.playing = true;
  audio.time = 3;
  const drawn = 3 + DISPLAY_LEAD_SECONDS;
  assert.ok(Math.abs(clock.seconds(1000) - drawn) < 1e-12);

  audio.playing = false;
  audio.time = 3.01;
  assert.ok(Math.abs(clock.seconds(1016) - drawn) < 1e-12);

  picture.release();
  assert.equal(clock.seconds(1032), 3.01);
});
