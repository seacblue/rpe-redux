/** The timing worker's measured reply, not-found answer, and transferred buffers. */
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTimingRequest } from "../../../frontend/screens/editor/workspace/timingDetection/timingDetectionWorkerProtocol.ts";

const SAMPLE_RATE = 22050;

test("the worker protocol replies with a not-found answer for silence", () => {
  const samples = new Float32Array(SAMPLE_RATE * 4);
  const message = analyzeTimingRequest({
    type: "analyze",
    samples,
    sampleRate: SAMPLE_RATE,
    duration: 4,
  });
  assert.equal(message.reply.type, "result");
  assert.equal(message.reply.result, null);
  assert.deepEqual(message.transfer, []);
});

test("the worker protocol keeps a not-found answer for very short audio", () => {
  const message = analyzeTimingRequest({
    type: "analyze",
    samples: new Float32Array(16),
    sampleRate: SAMPLE_RATE,
    duration: 16 / SAMPLE_RATE,
  });
  assert.equal(message.reply.type, "result");
  assert.equal(message.reply.result, null);
  assert.equal(message.transfer.length, 0);
});

test("a measured result transfers exactly three preview buffers", () => {
  const sampleRate = SAMPLE_RATE;
  const beat = 60 / 128;
  const duration = 12;
  const samples = new Float32Array(Math.round(sampleRate * duration));
  for (let time = 0.35; time < duration; time += beat) {
    const start = Math.round(time * sampleRate);
    for (let index = 0; index < sampleRate * 0.02 && start + index < samples.length; index++) {
      samples[start + index] = Math.exp(-index / (sampleRate * 0.004));
    }
  }
  const message = analyzeTimingRequest({ type: "analyze", samples, sampleRate, duration });
  assert.equal(message.reply.type, "result");
  const result = message.reply.result;
  assert.ok(result);
  assert.ok(Math.abs(result.bpm - 128) <= 0.001);
  assert.equal("confidence" in result, false);
  assert.equal("candidates" in result, false);
  assert.deepEqual(message.transfer, [
    result.waveform.peaks.buffer,
    result.onset.buffer,
    result.beatTimes.buffer,
  ]);
  assert.equal(message.transfer.length, 3);
  assert.ok(message.transfer.every((buffer) => buffer instanceof ArrayBuffer));
});
