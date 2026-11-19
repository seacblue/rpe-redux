/** Compare the DBN decoder with the autocorrelation detector on the same audio. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  detectBeatGridFromSamples,
  detectBeatGridWithDbnFromSamples,
} from "../../../core/media/beatDetection.ts";

const SAMPLE_RATE = 44100;

/**
 * A click track with an accent on every fourth beat.
 *
 * The accent gives the autocorrelation detector something to resolve half and
 * double time against, which is the case it was built for, so this is a fair
 * comparison rather than an easy win for either side.
 */
function accentedClickTrack(bpm, seconds, firstBeat = 0) {
  const samples = new Float32Array(Math.ceil(seconds * SAMPLE_RATE));
  const period = 60 / bpm;
  const clickLength = Math.round(0.04 * SAMPLE_RATE);
  for (let beat = 0; beat * period < seconds; beat += 1) {
    const start = Math.round((firstBeat + beat * period) * SAMPLE_RATE);
    const accent = beat % 4 === 0 ? 1 : 0.55;
    for (let index = 0; index < clickLength; index += 1) {
      const at = start + index;
      if (at >= samples.length) {
        break;
      }
      const decay = Math.exp((-index / SAMPLE_RATE) * 80);
      samples[at] += Math.sin((2 * Math.PI * 70 * index) / SAMPLE_RATE) * decay * accent;
    }
  }
  return samples;
}

/** Periodic phase difference between a reported offset and the true first beat. */
function phaseErrorSeconds(offsetMs, bpm, trueFirstBeat) {
  const period = 60 / bpm;
  let error = (((offsetMs / 1000 - trueFirstBeat) % period) + period) % period;
  if (error > period / 2) {
    error -= period;
  }
  return error;
}

test("both detectors find the tempo of an accented click track", () => {
  const samples = accentedClickTrack(120, 24);
  const autocorrelation = detectBeatGridFromSamples(samples, SAMPLE_RATE, 24);
  const dbn = detectBeatGridWithDbnFromSamples(samples, SAMPLE_RATE, 24);
  assert.ok(autocorrelation, "autocorrelation detector found a grid");
  assert.ok(dbn, "DBN detector found a grid");
  assert.ok(Math.abs(autocorrelation.bpm - 120) < 1, `autocorrelation ${autocorrelation.bpm}`);
  assert.ok(Math.abs(dbn.bpm - 120) < 1, `DBN ${dbn.bpm}`);
});

test("the DBN offset lands on the first beat", () => {
  const firstBeat = 0.137;
  const samples = accentedClickTrack(120, 24, firstBeat);
  const dbn = detectBeatGridWithDbnFromSamples(samples, SAMPLE_RATE, 24);
  assert.ok(dbn, "DBN detector found a grid");
  const error = phaseErrorSeconds(dbn.offsetMs, dbn.bpm, firstBeat);
  assert.ok(
    Math.abs(error) < 0.02,
    `phase error ${(error * 1000).toFixed(1)} ms at ${dbn.bpm} BPM`,
  );
});

test("the DBN reports the same result shape as the existing detector", () => {
  const samples = accentedClickTrack(100, 16);
  const dbn = detectBeatGridWithDbnFromSamples(samples, SAMPLE_RATE, 16);
  assert.ok(dbn);
  assert.equal(typeof dbn.bpm, "number");
  assert.equal(typeof dbn.offsetMs, "number");
  assert.equal(typeof dbn.onsetRate, "number");
  assert.ok(dbn.waveform.peaks.length > 0);
  assert.ok(dbn.onset.length > 0);
  assert.ok(dbn.beatTimes.length > 0);
  assert.ok(Math.abs(dbn.duration - 16) < 1e-6);
});

test("both detectors reject silence", () => {
  const silence = new Float32Array(SAMPLE_RATE * 8);
  assert.equal(detectBeatGridFromSamples(silence, SAMPLE_RATE, 8), null);
  assert.equal(detectBeatGridWithDbnFromSamples(silence, SAMPLE_RATE, 8), null);
});
