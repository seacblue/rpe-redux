/** Verify the activation features carry a pulse the decoder can track. */
import assert from "node:assert/strict";
import test from "node:test";
import { buildBeatActivation, monoFromBuffer } from "../../../core/media/beatActivation.ts";
import { decodeBeats } from "../../../core/media/beatDbn.ts";

const SAMPLE_RATE = 44100;
const BPM = 120;
const PERIOD = 60 / BPM;

/**
 * A click track: short decaying low sine bursts placed at exact sample indices.
 *
 * Every attack is positioned by sample, so the true beat time is known exactly
 * and any offset the pipeline reports is its own.
 */
function clickBuffer(firstBeat, beats, seconds) {
  const samples = new Float32Array(Math.ceil(seconds * SAMPLE_RATE));
  const length = Math.round(0.04 * SAMPLE_RATE);
  for (let beat = 0; beat < beats; beat += 1) {
    const start = Math.round((firstBeat + beat * PERIOD) * SAMPLE_RATE);
    for (let index = 0; index < length; index += 1) {
      const at = start + index;
      if (at >= samples.length) {
        break;
      }
      const decay = Math.exp((-index / SAMPLE_RATE) * 90);
      samples[at] += Math.sin((2 * Math.PI * 80 * index) / SAMPLE_RATE) * decay * 0.8;
    }
  }
  return {
    length: samples.length,
    numberOfChannels: 1,
    duration: seconds,
    sampleRate: SAMPLE_RATE,
    getChannelData: () => samples,
  };
}

test("mono mixing averages channels", () => {
  const left = new Float32Array([1, 2, 3]);
  const right = new Float32Array([3, 2, 1]);
  const buffer = {
    length: 3,
    numberOfChannels: 2,
    duration: 1,
    sampleRate: SAMPLE_RATE,
    getChannelData: (channel) => (channel === 0 ? left : right),
  };
  const mono = monoFromBuffer(buffer);
  assert.deepEqual([...mono], [2, 2, 2]);
});

test("the activation has a pulse at every click", () => {
  const buffer = clickBuffer(0, 20, 10);
  const activation = buildBeatActivation(buffer, SAMPLE_RATE);
  assert.ok(activation, "activation was built");
  assert.ok(activation.fps > 20, `usable frame rate, got ${activation.fps}`);
  assert.equal(activation.values.length > 100, true);

  // Peaks should be separated by roughly one beat period.
  const peaks = [];
  for (let frame = 1; frame < activation.values.length - 1; frame += 1) {
    const value = activation.values[frame];
    if (
      value > 0.25 &&
      value >= activation.values[frame - 1] &&
      value > activation.values[frame + 1]
    ) {
      peaks.push(frame / activation.fps);
    }
  }
  assert.ok(peaks.length >= 10, `found ${peaks.length} activation peaks`);
});

test("the decoder recovers the tempo from real click audio", () => {
  const buffer = clickBuffer(0, 32, 16);
  const activation = buildBeatActivation(buffer, SAMPLE_RATE);
  assert.ok(activation);
  const beats = decodeBeats(activation.values, activation.fps);
  assert.ok(beats && beats.length > 20, `decoded ${beats?.length ?? 0} beats`);
  const mean = (beats.at(-1) - beats[0]) / (beats.length - 1);
  const measured = 60 / mean;
  assert.ok(
    Math.abs(measured - BPM) < 2,
    `expected about ${BPM} BPM, measured ${measured.toFixed(2)}`,
  );
});

test("a silent buffer produces no activation pulse", () => {
  const samples = new Float32Array(SAMPLE_RATE * 3);
  const buffer = {
    length: samples.length,
    numberOfChannels: 1,
    duration: 3,
    sampleRate: SAMPLE_RATE,
    getChannelData: () => samples,
  };
  const activation = buildBeatActivation(buffer, SAMPLE_RATE);
  assert.ok(activation, "an activation is still produced");
  assert.equal(decodeBeats(activation.values, activation.fps), null);
});

test("an empty or invalid buffer yields no activation", () => {
  const empty = {
    length: 0,
    numberOfChannels: 1,
    duration: 0,
    sampleRate: SAMPLE_RATE,
    getChannelData: () => new Float32Array(0),
  };
  assert.equal(buildBeatActivation(empty, SAMPLE_RATE), null);
  assert.equal(buildBeatActivation(clickBuffer(0, 4, 2), 0), null);
});
