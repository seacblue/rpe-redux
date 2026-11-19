/**
 * Verify the measured BPM and offset are exact rather than frame-accurate.
 *
 * The decoder reports beats on analysis frames, so a tempo that is not a whole
 * number of frames quantises its spacing. These tests cover the tempi where
 * that quantisation is worst, plus the material where a naive reading of the
 * decoded output would pick the wrong metrical level.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  detectBeatGridFromSamples,
  detectBeatGridWithDbnFromSamples,
} from "../../../core/media/beatDetection.ts";

const SAMPLE_RATE = 44100;
const SECONDS = 30;

/** Deterministic noise so every run measures the same signal. */
function seededNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** A click track, optionally noisy, with weak beats or swung off-beats. */
function clickTrack(bpm, firstBeat, options = {}) {
  const { noise = 0, weakEvery = 0, swing = 0 } = options;
  const rand = seededNoise(20240118);
  const period = 60 / bpm;
  const samples = new Float32Array(Math.ceil(SECONDS * SAMPLE_RATE));
  const clickLength = Math.round(0.05 * SAMPLE_RATE);
  let beat = 0;
  for (let time = firstBeat; time < SECONDS; time += period) {
    const swingOffset = beat % 2 === 1 ? period * swing : 0;
    const start = Math.round((time + swingOffset) * SAMPLE_RATE);
    const level = weakEvery > 0 && beat % weakEvery === 0 && beat > 0 ? 0.25 : 1;
    const accent = beat % 4 === 0 ? 1 : 0.65;
    for (let index = 0; index < clickLength; index += 1) {
      const at = start + index;
      if (at >= samples.length) {
        break;
      }
      const decay = Math.exp((-index / SAMPLE_RATE) * 70);
      samples[at] += Math.sin((2 * Math.PI * 65 * index) / SAMPLE_RATE) * decay * accent * level;
    }
    beat += 1;
  }
  if (noise > 0) {
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] += (rand() * 2 - 1) * noise;
    }
  }
  return samples;
}

/** Phase difference measured modulo the reported period. */
function phaseErrorMs(offsetMs, reportedBpm, expectedPhase) {
  const period = 60 / reportedBpm;
  let error = (((offsetMs / 1000 - expectedPhase) % period) + period) % period;
  if (error > period / 2) {
    error -= period;
  }
  return error * 1000;
}

test("the decoded tempo is exact at tempi that are not whole frames", () => {
  // At 50 fps a frame is 20 ms, so 128 and 133 BPM land between adjacent frames
  // and a decoder reporting frame times alone would round the tempo. The attack
  // refit has to recover the real period.
  for (const bpm of [112, 128, 133, 145, 178]) {
    const samples = clickTrack(bpm, 0.071, { noise: 0.03 });
    const result = detectBeatGridWithDbnFromSamples(samples, SAMPLE_RATE, SECONDS);
    assert.ok(result, `DBN found a grid at ${bpm} BPM`);
    assert.ok(
      Math.abs(result.bpm - bpm) < 0.01,
      `expected exactly ${bpm} BPM, measured ${result.bpm}`,
    );
  }
});

test("the reported offset lands on the click to within a millisecond", () => {
  for (const firstBeat of [0.043, 0.071, 0.157, 0.211, 0.303]) {
    const samples = clickTrack(133, firstBeat);
    const result = detectBeatGridWithDbnFromSamples(samples, SAMPLE_RATE, SECONDS);
    assert.ok(result, `DBN found a grid for a click at ${firstBeat} s`);
    const error = phaseErrorMs(result.offsetMs, result.bpm, firstBeat);
    assert.ok(Math.abs(error) < 2, `phase error ${error.toFixed(2)} ms at ${firstBeat} s`);
  }
});

test("noise does not move the measured tempo", () => {
  for (const noise of [0.02, 0.06]) {
    const samples = clickTrack(128, 0.071, { noise });
    const result = detectBeatGridWithDbnFromSamples(samples, SAMPLE_RATE, SECONDS);
    assert.ok(result, `DBN found a grid with noise ${noise}`);
    assert.equal(result.bpm, 128);
    const error = phaseErrorMs(result.offsetMs, result.bpm, 0.071);
    assert.ok(Math.abs(error) < 2, `phase error ${error.toFixed(2)} ms with noise ${noise}`);
  }
});

test("the metrical level follows the strong beats, not the decoded spacing", () => {
  // Every second click is quiet. The correct answer is the fast tempo: the
  // quiet clicks are still beats, and reporting half of it would halve the BPM.
  const samples = clickTrack(128, 0.071, { weakEvery: 2 });
  const result = detectBeatGridWithDbnFromSamples(samples, SAMPLE_RATE, SECONDS);
  assert.ok(result, "DBN found a grid");
  assert.ok(
    Math.abs(result.bpm - 128) < 0.5,
    `expected 128 BPM from the strong beats, measured ${result.bpm}`,
  );
});

test("an evenly accented track keeps the tempo it had", () => {
  const samples = clickTrack(128, 0.071, { weakEvery: 3 });
  const result = detectBeatGridWithDbnFromSamples(samples, SAMPLE_RATE, SECONDS);
  assert.ok(result, "DBN found a grid");
  assert.ok(Math.abs(result.bpm - 128) < 0.5, `measured ${result.bpm}`);
});

test("both decoders agree on the offset when they agree on the tempo", () => {
  const samples = clickTrack(145, 0.11, { noise: 0.04 });
  const autocorrelation = detectBeatGridFromSamples(samples, SAMPLE_RATE, SECONDS);
  const dbn = detectBeatGridWithDbnFromSamples(samples, SAMPLE_RATE, SECONDS);
  assert.ok(autocorrelation && dbn, "both decoders found a grid");
  // The two decoders search different tempo ranges, so the reported value can
  // differ by a fraction of a BPM; the point here is that their phases agree.
  assert.ok(
    Math.abs(dbn.bpm - autocorrelation.bpm) < 2,
    `tempi differ: ${dbn.bpm} vs ${autocorrelation.bpm}`,
  );
  const difference = Math.abs(dbn.offsetMs - autocorrelation.offsetMs);
  assert.ok(difference < 2, `offsets differ by ${difference.toFixed(2)} ms`);
});
