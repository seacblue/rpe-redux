/** Verify visual playback interpolation without changing the authoritative audio clock. */
import assert from "node:assert/strict";
import test from "node:test";
import { createVisualPlaybackClock } from "../../../frontend/screens/editor/workspace/runtime/frame/frameClock.ts";

test("visual playback clock fills coarse audio samples", () => {
  const audio = { playing: false, time: 0, rate: 1 };
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
  const audio = { playing: true, time: 2, rate: 1 };
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
