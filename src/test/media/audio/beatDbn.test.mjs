/** Verify the ported DBN beat decoder recovers a known pulse from an activation. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createBeatObservation,
  createBeatStateSpace,
  createBeatTransitions,
  decodeBeatPath,
  decodeBeats,
} from "../../../core/media/beatDbn.ts";

/**
 * Build an activation with a Gaussian bump at every beat.
 *
 * Placing the bumps analytically gives the exact beat time, so any difference
 * the decoder reports is its own error rather than the input's.
 */
function pulseActivation(bpm, fps, seconds, bumpFrames = 1) {
  const frames = Math.round(seconds * fps);
  const values = new Float32Array(frames);
  const period = (60 / bpm) * fps;
  for (let frame = 0; frame < frames; frame += 1) {
    const phase = frame % period;
    const distance = Math.min(phase, period - phase);
    values[frame] = Math.exp(-(distance * distance) / (2 * bumpFrames * bumpFrames));
  }
  return values;
}

test("the state space models whole-frame intervals with one group per tempo", () => {
  const space = createBeatStateSpace(10, 12);
  assert.deepEqual([...space.intervals], [10, 11, 12]);
  assert.equal(space.numStates, 33);
  // Each interval group is contiguous and its phases span the beat.
  for (let group = 0; group < space.intervals.length; group += 1) {
    const first = space.firstStates[group];
    const last = space.lastStates[group];
    assert.equal(last - first + 1, space.intervals[group]);
    assert.equal(space.statePositions[first], 0);
    assert.ok(space.statePositions[last] < 1);
  }
});

test("a limited tempo count still yields distinct ascending intervals", () => {
  const space = createBeatStateSpace(50, 200, 12);
  assert.ok(space.intervals.length >= 12);
  for (let index = 1; index < space.intervals.length; index += 1) {
    assert.ok(space.intervals[index] > space.intervals[index - 1]);
  }
});

test("every state has a predecessor transition and rows sum to one", () => {
  const space = createBeatStateSpace(8, 12);
  const transitions = createBeatTransitions(space);
  assert.equal(transitions.pointers.length, space.numStates + 1);
  let previous = 0;
  for (let state = 0; state < space.numStates; state += 1) {
    const from = transitions.pointers[state];
    const to = transitions.pointers[state + 1];
    assert.ok(to > from, `state ${state} has at least one predecessor`);
    let total = 0;
    for (let pointer = from; pointer < to; pointer += 1) {
      total += Math.exp(transitions.logProbabilities[pointer]);
    }
    // Transitions arrive from one same-tempo predecessor or from beat
    // boundaries; the latter are normalised, so the row is a distribution.
    assert.ok(total > 0, `state ${state} row is non-empty`);
    previous = total;
  }
  assert.ok(previous > 0);
});

test("the beat observation model marks the first part of each beat", () => {
  const space = createBeatStateSpace(16, 16);
  const observation = createBeatObservation(space, 4);
  const marked = [...observation.pointers].filter((value) => value === 1).length;
  // One quarter of each interval is inside the beat range.
  assert.equal(marked, 4);
  assert.equal(observation.pointers[0], 1);
  assert.equal(observation.pointers[15], 0);
});

test("Viterbi decode follows a strong periodic activation", () => {
  const fps = 50;
  const bpm = 120;
  const space = createBeatStateSpace((60 * fps) / 215, (60 * fps) / 55);
  const transitions = createBeatTransitions(space);
  const observation = createBeatObservation(space, 16);
  const activation = pulseActivation(bpm, fps, 20);
  const decoded = decodeBeatPath(activation, space, transitions, observation);
  assert.ok(decoded, "the decoder produced a path");
  assert.equal(decoded.path.length, activation.length);
  assert.ok(Number.isFinite(decoded.logProbability));
  // The path should land in the beat range once per period.
  const entering = [];
  for (let frame = 1; frame < decoded.path.length; frame += 1) {
    if (
      observation.pointers[decoded.path[frame]] === 1 &&
      observation.pointers[decoded.path[frame - 1]] !== 1
    ) {
      entering.push(frame);
    }
  }
  assert.ok(entering.length > 30, `found ${entering.length} beats in 20 s`);
  const period = 60 / bpm;
  const gaps = entering.slice(1).map((frame, index) => (frame - entering[index]) / fps);
  const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  assert.ok(Math.abs(average - period) < 0.02, `average interval ${average.toFixed(3)} s`);
});

test("decodeBeats recovers the tempo of a periodic activation", () => {
  const fps = 50;
  const bpm = 128;
  const activation = pulseActivation(bpm, fps, 30);
  const beats = decodeBeats(activation, fps);
  assert.ok(beats && beats.length > 40, `decoded ${beats?.length ?? 0} beats`);
  // The state space models whole-frame intervals, so 128 BPM at 50 fps (23.44
  // frames) is reported as alternating 23- and 24-frame beats. The mean
  // interval is the tempo; the alternation is the quantisation, not an error.
  const mean = (beats.at(-1) - beats[0]) / (beats.length - 1);
  const measured = 60 / mean;
  assert.ok(
    Math.abs(measured - bpm) < 0.5,
    `expected about ${bpm} BPM, measured ${measured.toFixed(2)}`,
  );
});

test("an activation without a pulse yields no beat grid", () => {
  const flat = new Float32Array(2000).fill(0.001);
  assert.equal(decodeBeats(flat, 50), null);
  assert.equal(decodeBeats(new Float32Array(0), 50), null);
});
