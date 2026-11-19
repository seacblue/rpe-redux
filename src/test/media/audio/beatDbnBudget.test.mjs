/** Verify the ported decoder stays usable on a full-length track. */
import assert from "node:assert/strict";
import test from "node:test";
import { createBeatStateSpace, decodeBeats } from "../../../core/media/beatDbn.ts";

/** A pulse activation over a three-minute track at the given tempo. */
function longActivation(bpm, fps, seconds) {
  const frames = Math.round(seconds * fps);
  const values = new Float32Array(frames);
  const period = (60 / bpm) * fps;
  for (let frame = 0; frame < frames; frame += 1) {
    const phase = frame % period;
    const distance = Math.min(phase, period - phase);
    values[frame] = Math.exp(-(distance * distance) / 2);
  }
  return values;
}

test("a three-minute activation decodes well inside an interactive budget", () => {
  const activation = longActivation(128, 50, 180);
  const started = performance.now();
  const beats = decodeBeats(activation, 50);
  const elapsed = performance.now() - started;
  assert.ok(beats && beats.length > 300, `decoded ${beats?.length ?? 0} beats`);
  const mean = (beats.at(-1) - beats[0]) / (beats.length - 1);
  assert.ok(Math.abs(60 / mean - 128) < 0.5);
  // The decode is a background analysis step, not a per-frame cost; a full
  // track must still finish quickly enough to feel like a normal wait.
  assert.ok(elapsed < 4000, `decode took ${elapsed.toFixed(0)} ms`);
});

test("the default linear tempo grid stays a small state space", () => {
  // 55..215 BPM at 50 fps spans intervals 14..55 frames. A linear grid is the
  // sum of those intervals, which is what keeps the Viterbi table bounded.
  const space = createBeatStateSpace((60 * 50) / 215, (60 * 50) / 55);
  assert.ok(space.numStates > 1000);
  assert.ok(space.numStates < 2000, `state space has ${space.numStates} states`);
});

test("a tempo-limited grid is smaller than the linear grid", () => {
  const linear = createBeatStateSpace((60 * 50) / 215, (60 * 50) / 55);
  const limited = createBeatStateSpace((60 * 50) / 215, (60 * 50) / 55, 16);
  assert.ok(limited.numStates < linear.numStates);
});
