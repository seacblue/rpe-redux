/**
 * Hold the reported BPM and offset to a tight tolerance.
 *
 * Every case renders a click track whose onsets sit at known sample indices, so
 * the true tempo and phase are exact numbers rather than estimates. The
 * tolerances here are the product requirement: a BPM within 0.01 of the truth
 * and an offset within a couple of milliseconds, across tempo, duration, noise,
 * and fractional tempi.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { detectBeatGridWithDbnFromSamples } from "../../../core/media/beatDetection.ts";

const SAMPLE_RATE = 44100;
const BPM_TOLERANCE = 0.01;
const OFFSET_TOLERANCE_MS = 3;

/**
 * Repeated decaying sine clicks at exact onset times.
 *
 * `noise` is deterministic so a failure can be reproduced; the seed is fixed.
 */
function clickTrack(bpm, firstBeat, seconds, noise = 0) {
  const period = 60 / bpm;
  const samples = new Float32Array(Math.ceil(seconds * SAMPLE_RATE));
  const length = Math.round(0.05 * SAMPLE_RATE);
  for (let beat = 0; firstBeat + beat * period < seconds; beat += 1) {
    const start = Math.round((firstBeat + beat * period) * SAMPLE_RATE);
    for (let index = 0; index < length; index += 1) {
      const at = start + index;
      if (at >= samples.length) {
        break;
      }
      const decay = Math.exp((-index / SAMPLE_RATE) * 70);
      samples[at] += Math.sin((2 * Math.PI * 65 * index) / SAMPLE_RATE) * decay;
    }
  }
  if (noise > 0) {
    let state = 12345;
    for (let index = 0; index < samples.length; index += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      samples[index] += ((state / 4294967296) * 2 - 1) * noise;
    }
  }
  return samples;
}

/** Phase difference between a reported offset and the true first beat, modulo the period. */
function phaseErrorMs(offsetMs, reportedBpm, trueFirstBeat) {
  const period = 60 / reportedBpm;
  let error = (((offsetMs / 1000 - trueFirstBeat) % period) + period) % period;
  if (error > period / 2) {
    error -= period;
  }
  return error * 1000;
}

test("integer tempi are reported within 0.01 BPM", () => {
  const firstBeat = 0.0837;
  const tempi = [70, 90, 100, 112, 128, 133, 145, 160, 175, 190];
  for (const bpm of tempi) {
    const result = detectBeatGridWithDbnFromSamples(
      clickTrack(bpm, firstBeat, 30),
      SAMPLE_RATE,
      30,
    );
    assert.ok(result, `${bpm} BPM: a grid was found`);
    assert.ok(
      Math.abs(result.bpm - bpm) <= BPM_TOLERANCE,
      `${bpm} BPM: measured ${result.bpm}, off by ${(result.bpm - bpm).toFixed(4)}`,
    );
  }
});

test("fractional tempi are reported within 0.01 BPM", () => {
  const firstBeat = 0.0837;
  for (const bpm of [128.5, 133.33, 174.75, 162.4]) {
    const result = detectBeatGridWithDbnFromSamples(
      clickTrack(bpm, firstBeat, 30),
      SAMPLE_RATE,
      30,
    );
    assert.ok(result, `${bpm} BPM: a grid was found`);
    assert.ok(
      Math.abs(result.bpm - bpm) <= BPM_TOLERANCE,
      `${bpm} BPM: measured ${result.bpm}, off by ${(result.bpm - bpm).toFixed(4)}`,
    );
  }
});

test("noise does not push the tempo past the tolerance", () => {
  const firstBeat = 0.0837;
  for (const noise of [0.02, 0.05]) {
    for (const bpm of [112, 128, 145, 190]) {
      const result = detectBeatGridWithDbnFromSamples(
        clickTrack(bpm, firstBeat, 30, noise),
        SAMPLE_RATE,
        30,
      );
      assert.ok(result, `${bpm} BPM at noise ${noise}: a grid was found`);
      assert.ok(
        Math.abs(result.bpm - bpm) <= BPM_TOLERANCE,
        `${bpm} BPM at noise ${noise}: measured ${result.bpm}`,
      );
    }
  }
});

test("a short buffer still holds the tempo tolerance", () => {
  const firstBeat = 0.0837;
  for (const seconds of [8, 12]) {
    const result = detectBeatGridWithDbnFromSamples(
      clickTrack(128, firstBeat, seconds),
      SAMPLE_RATE,
      seconds,
    );
    assert.ok(result, `${seconds}s: a grid was found`);
    assert.ok(Math.abs(result.bpm - 128) <= BPM_TOLERANCE, `${seconds}s: measured ${result.bpm}`);
  }
});

test("the offset lands within a few milliseconds at every tempo", () => {
  const firstBeat = 0.0837;
  for (const bpm of [70, 112, 128, 145, 190]) {
    const result = detectBeatGridWithDbnFromSamples(
      clickTrack(bpm, firstBeat, 30),
      SAMPLE_RATE,
      30,
    );
    assert.ok(result, `${bpm} BPM: a grid was found`);
    const error = phaseErrorMs(result.offsetMs, result.bpm, firstBeat);
    assert.ok(
      Math.abs(error) <= OFFSET_TOLERANCE_MS,
      `${bpm} BPM: offset ${result.offsetMs} ms is ${error.toFixed(2)} ms off`,
    );
  }
});

test("a longer track tightens the fit rather than drifting", () => {
  // The refit spans the whole track, so more beats must not mean more error:
  // a drifting period would show up as a later offset.
  const firstBeat = 0.0837;
  const errors = [];
  for (const seconds of [10, 30, 60]) {
    const result = detectBeatGridWithDbnFromSamples(
      clickTrack(133, firstBeat, seconds),
      SAMPLE_RATE,
      seconds,
    );
    assert.ok(result, `${seconds}s: a grid was found`);
    assert.ok(Math.abs(result.bpm - 133) <= BPM_TOLERANCE, `${seconds}s: measured ${result.bpm}`);
    errors.push(Math.abs(phaseErrorMs(result.offsetMs, result.bpm, firstBeat)));
  }
  for (const error of errors) {
    assert.ok(error <= OFFSET_TOLERANCE_MS, `phase error ${error.toFixed(2)} ms`);
  }
});
