/** Verify fixed BPM/offset output on steady and changing pulse material. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  detectBeatGridWithDbnFromSamples,
  detectBestFixedTimingFromSamples,
} from "../../../core/media/beatDetection.ts";

const SAMPLE_RATE = 44100;

/** A click track whose pulse follows `bpmAt(time)`. */
function renderTempoCurve(bpmAt, seconds) {
  const samples = new Float32Array(Math.ceil(seconds * SAMPLE_RATE));
  const length = Math.round(0.05 * SAMPLE_RATE);
  let time = 0.1;
  while (time < seconds) {
    const start = Math.round(time * SAMPLE_RATE);
    for (let offset = 0; offset < length; offset += 1) {
      const at = start + offset;
      if (at >= samples.length) {
        break;
      }
      samples[at] +=
        Math.sin((2 * Math.PI * 65 * offset) / SAMPLE_RATE) *
        Math.exp((-offset / SAMPLE_RATE) * 70);
    }
    time += 60 / bpmAt(time);
  }
  return samples;
}

function assertFixedResult(result, label) {
  assert.ok(result, `${label}: a grid was found`);
  assert.ok(result.bpm > 0, `${label}: BPM is positive`);
  assert.ok(Number.isFinite(result.offsetMs), `${label}: offset is finite`);
  assert.equal("tempoSegments" in result, false, `${label}: no tempo map is exposed`);
  assert.equal("variableTempo" in result, false, `${label}: no variable-tempo flag is exposed`);
}

test("steady tracks return one fixed BPM and offset", () => {
  for (const bpm of [100, 128, 145]) {
    const result = detectBeatGridWithDbnFromSamples(
      renderTempoCurve(() => bpm, 30),
      SAMPLE_RATE,
      30,
    );
    assertFixedResult(result, `${bpm} BPM`);
    assert.ok(Math.abs(result.bpm - bpm) < 1, `${bpm} BPM: reports ${result.bpm}`);
  }
});

test("a tempo-changing input still returns one fixed answer", () => {
  const result = detectBeatGridWithDbnFromSamples(
    renderTempoCurve((time) => (time < 15 ? 100 : 130), 30),
    SAMPLE_RATE,
    30,
  );
  assertFixedResult(result, "step tempo input");
});

test("slowing and drifting inputs do not widen the public result", () => {
  for (const bpmAt of [(time) => (time < 15 ? 120 : 90), (time) => 100 + (20 * time) / 30]) {
    const result = detectBeatGridWithDbnFromSamples(renderTempoCurve(bpmAt, 30), SAMPLE_RATE, 30);
    assertFixedResult(result, "changing tempo input");
  }
});

test("the combined detector keeps a clear high-tempo pulse", () => {
  const result = detectBestFixedTimingFromSamples(
    renderTempoCurve(() => 240, 20),
    SAMPLE_RATE,
    20,
  );
  assertFixedResult(result, "combined high-tempo input");
  assert.ok(Math.abs(result.bpm - 240) < 1, `combined detector reports ${result.bpm}`);
});

test("the combined detector keeps fractional fixed BPM precision", () => {
  const expectedBpm = 137.3;
  const expectedOffsetMs = 123;
  const samples = new Float32Array(Math.ceil(18 * SAMPLE_RATE));
  const clickLength = Math.round(0.02 * SAMPLE_RATE);
  for (let time = expectedOffsetMs / 1000; time < 18; time += 60 / expectedBpm) {
    const start = Math.round(time * SAMPLE_RATE);
    for (let offset = 0; offset < clickLength && start + offset < samples.length; offset += 1) {
      samples[start + offset] +=
        Math.sin((2 * Math.PI * 65 * offset) / SAMPLE_RATE) *
        Math.exp((-offset / SAMPLE_RATE) * 80);
    }
  }
  const result = detectBestFixedTimingFromSamples(samples, SAMPLE_RATE, 18);
  assertFixedResult(result, "fractional fixed input");
  assert.ok(Math.abs(result.bpm - expectedBpm) <= 0.1, `reports ${result.bpm} BPM`);
  assert.ok(Math.abs(result.offsetMs - expectedOffsetMs) <= 2, `reports ${result.offsetMs} ms`);
});
