/** Verify tempo segments: steady tracks report one, changes report more. */
import assert from "node:assert/strict";
import test from "node:test";
import { detectBeatGridWithDbnFromSamples } from "../../../core/media/beatDetection.ts";

const SAMPLE_RATE = 44100;

/** A click track whose tempo follows `bpmAt(time)`. */
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

test("a steady track reports one tempo stretch", () => {
  for (const bpm of [100, 128, 145]) {
    const result = detectBeatGridWithDbnFromSamples(
      renderTempoCurve(() => bpm, 30),
      SAMPLE_RATE,
      30,
    );
    assert.ok(result, `${bpm} BPM: a grid was found`);
    assert.equal(result.variableTempo, false, `${bpm} BPM is steady`);
    assert.equal(result.tempoSegments?.length, 1, `${bpm} BPM yields one stretch`);
    const segment = result.tempoSegments[0];
    assert.ok(Math.abs(segment.bpm - bpm) < 1, `${bpm} BPM: segment reports ${segment.bpm}`);
  }
});

test("a step tempo change reports both tempi at the right boundary", () => {
  const result = detectBeatGridWithDbnFromSamples(
    renderTempoCurve((time) => (time < 15 ? 100 : 130), 30),
    SAMPLE_RATE,
    30,
  );
  assert.ok(result, "a grid was found");
  assert.equal(result.variableTempo, true, "the track changes tempo");
  const segments = result.tempoSegments;
  assert.ok(segments && segments.length === 2, `two stretches, got ${segments?.length}`);
  assert.ok(Math.abs(segments[0].bpm - 100) < 3, `first stretch ${segments[0].bpm}`);
  assert.ok(Math.abs(segments[1].bpm - 130) < 3, `second stretch ${segments[1].bpm}`);
  // The change lands at 15 s; a stretch boundary a second or two either side is
  // within what the smoothing window can resolve.
  assert.ok(
    Math.abs(segments[1].startMs - 15000) < 2500,
    `boundary at ${segments[1].startMs} ms, expected near 15000`,
  );
});

test("a slowing track reports the change in the right direction", () => {
  const result = detectBeatGridWithDbnFromSamples(
    renderTempoCurve((time) => (time < 15 ? 120 : 90), 30),
    SAMPLE_RATE,
    30,
  );
  assert.ok(result);
  const segments = result.tempoSegments ?? [];
  assert.equal(result.variableTempo, true);
  assert.ok(segments.length >= 2, `at least two stretches, got ${segments.length}`);
  assert.ok(segments[0].bpm > segments[segments.length - 1].bpm, "the tempo falls");
  assert.ok(Math.abs(segments[0].bpm - 120) < 4, `first stretch ${segments[0].bpm}`);
  assert.ok(Math.abs(segments.at(-1).bpm - 90) < 4, `last stretch ${segments.at(-1).bpm}`);
});

test("a drifting track reports more than one stretch", () => {
  const result = detectBeatGridWithDbnFromSamples(
    renderTempoCurve((time) => 100 + (20 * time) / 30, 30),
    SAMPLE_RATE,
    30,
  );
  assert.ok(result);
  assert.equal(result.variableTempo, true, "a drifting tempo is not steady");
  const segments = result.tempoSegments ?? [];
  assert.ok(segments.length >= 2, `at least two stretches, got ${segments.length}`);
  assert.ok(
    segments.at(-1).bpm > segments[0].bpm,
    `tempo rises: ${segments[0].bpm} -> ${segments.at(-1).bpm}`,
  );
});

test("the single-tempo answer stays available alongside the stretches", () => {
  // A caller that only reads `bpm` must still get something usable: it is the
  // overall best fit, which on a changing track is the dominant tempo.
  const result = detectBeatGridWithDbnFromSamples(
    renderTempoCurve((time) => (time < 15 ? 100 : 130), 30),
    SAMPLE_RATE,
    30,
  );
  assert.ok(result);
  assert.ok(result.bpm > 50 && result.bpm < 220, `single answer ${result.bpm}`);
  assert.ok(result.offsetMs >= 0, `offset ${result.offsetMs}`);
  assert.ok(result.beatTimes.length > 0, "beat times are still produced");
});
