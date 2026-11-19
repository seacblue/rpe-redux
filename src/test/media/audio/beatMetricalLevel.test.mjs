/**
 * Verify the decoder holds its metrical level across rhythm patterns.
 *
 * Every case renders a pattern of known onsets, so the pulse that exists in the
 * audio is known exactly: the test asserts the detector reports *that* pulse,
 * not a nominal BPM. Patterns whose pulse falls outside the reporting range are
 * skipped rather than asserted, because reporting them would be a different
 * requirement.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { detectBeatGridWithDbnFromSamples } from "../../../core/media/beatDetection.ts";

const SAMPLE_RATE = 44100;
const SECONDS = 24;
const MIN_BPM = 50;
const MAX_BPM = 220;

/** A decaying sine burst at every listed beat position. */
function render(bpm, firstBeat, hits, noise = 0) {
  const period = 60 / bpm;
  const samples = new Float32Array(Math.ceil(SECONDS * SAMPLE_RATE));
  const length = Math.round(0.05 * SAMPLE_RATE);
  for (const hit of hits) {
    const start = Math.round((firstBeat + hit.beat * period) * SAMPLE_RATE);
    for (let index = 0; index < length; index += 1) {
      const at = start + index;
      if (at >= samples.length) {
        break;
      }
      const decay = Math.exp((-index / SAMPLE_RATE) * 70);
      const tone = hit.tone ?? 65;
      samples[at] += Math.sin((2 * Math.PI * tone * index) / SAMPLE_RATE) * decay * hit.level;
    }
  }
  if (noise > 0) {
    let state = 7;
    for (let index = 0; index < samples.length; index += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      samples[index] += ((state / 4294967296) * 2 - 1) * noise;
    }
  }
  return samples;
}

/** Repeats a per-bar level table over the whole render. */
function barPattern(bpm, table, extras = []) {
  const total = Math.floor((SECONDS - 0.5) / (60 / bpm));
  const hits = [];
  for (let beat = 0; beat < total; beat += 1) {
    const level = table[beat % table.length];
    if (level > 0) {
      hits.push({ beat, level });
    }
  }
  return [...hits, ...extras];
}

/** The tempo of the shortest interval that recurs, in BPM. */
function pulseBpm(bpm, hits) {
  const beats = [...new Set(hits.map((hit) => hit.beat))].sort((left, right) => left - right);
  const counts = new Map();
  for (let index = 1; index < beats.length; index += 1) {
    const gap = Math.round((beats[index] - beats[index - 1]) * 100) / 100;
    counts.set(gap, (counts.get(gap) ?? 0) + 1);
  }
  const shortest = [...counts].sort((left, right) => right[1] - left[1])[0][0];
  return bpm / shortest;
}

/** Report the pulse the detector should return, or null when it is out of range. */
function expectedPulse(bpm, hits) {
  let expected = pulseBpm(bpm, hits);
  if (expected < MIN_BPM) {
    expected *= 2;
  }
  if (expected > MAX_BPM) {
    expected /= 2;
  }
  return expected >= MIN_BPM && expected <= MAX_BPM ? expected : null;
}

test("the reported tempo follows the pulse that is actually in the audio", () => {
  const bpm = 128;
  const cases = [
    ["plain quarters", barPattern(bpm, [1])],
    ["accented backbeat", barPattern(bpm, [1, 0.3, 0.5, 0.3])],
    ["backbeat only", barPattern(bpm, [1, 0, 0.9, 0])],
    ["beats 1 and 3", barPattern(bpm, [1, 0, 1, 0])],
    ["beats 2 and 4", barPattern(bpm, [0, 1, 0, 1])],
    ["3/4", barPattern(bpm, [1, 0.55, 0.55])],
    ["5/4", barPattern(bpm, [1, 0.55, 0.55, 0.55, 0.55])],
    ["7/4", barPattern(bpm, [1, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55])],
  ];
  for (const [label, hits] of cases) {
    const expected = expectedPulse(bpm, hits);
    assert.ok(expected, `${label}: pattern has a pulse in range`);
    const result = detectBeatGridWithDbnFromSamples(render(bpm, 0.05, hits), SAMPLE_RATE, SECONDS);
    assert.ok(result, `${label}: a grid was found`);
    const error = Math.abs(result.bpm - expected) / expected;
    assert.ok(error < 0.02, `${label}: expected ${expected.toFixed(1)}, measured ${result.bpm}`);
  }
});

test("a quiet beat between loud beats still counts as a beat", () => {
  // The decoder tends to settle on every second beat here; the quiet hits at
  // 0.3 and 0.5 are real, so the answer must stay at the fast tempo. An
  // amplitude threshold cannot tell this pattern apart from one that has
  // nothing between the beats, which is why the decision uses attack presence.
  const bpm = 128;
  const hits = barPattern(bpm, [1, 0.3, 0.5, 0.3]);
  const result = detectBeatGridWithDbnFromSamples(render(bpm, 0.05, hits), SAMPLE_RATE, SECONDS);
  assert.ok(result);
  assert.ok(
    Math.abs(result.bpm - 128) < 1,
    `expected 128 from the quiet beats, measured ${result.bpm}`,
  );
});

test("noise does not change the metrical level", () => {
  const bpm = 128;
  for (const noise of [0.02, 0.05]) {
    const hits = barPattern(bpm, [1]);
    const result = detectBeatGridWithDbnFromSamples(
      render(bpm, 0.05, hits, noise),
      SAMPLE_RATE,
      SECONDS,
    );
    assert.ok(result, `a grid was found with noise ${noise}`);
    assert.ok(
      Math.abs(result.bpm - bpm) < 1,
      `expected ${bpm} with noise ${noise}, measured ${result.bpm}`,
    );
  }
});

test("the tempo range is honoured at both ends", () => {
  for (const bpm of [70, 90, 110, 150, 175, 190]) {
    const hits = barPattern(bpm, [1]);
    const result = detectBeatGridWithDbnFromSamples(render(bpm, 0.07, hits), SAMPLE_RATE, SECONDS);
    assert.ok(result, `a grid was found at ${bpm} BPM`);
    assert.ok(Math.abs(result.bpm - bpm) < 0.5, `expected ${bpm}, measured ${result.bpm}`);
  }
});

test("a fast chart is reported at its own tempo", () => {
  // Charts reach 350 BPM, so the range covers it. Measured on clicks from 70 to
  // 350, the primary answer is correct across the whole span; the candidate list
  // is what makes a wide range honest when the activation supports a multiple.
  for (const bpm of [205, 240, 300, 350]) {
    const hits = barPattern(bpm, [1]);
    const result = detectBeatGridWithDbnFromSamples(render(bpm, 0.05, hits), SAMPLE_RATE, SECONDS);
    assert.ok(result, `a grid was found at ${bpm} BPM`);
    assert.ok(
      Math.abs(result.bpm - bpm) < bpm * 0.05,
      `expected about ${bpm}, measured ${result.bpm}`,
    );
  }
});

test("the reported offset stays on the first beat for every pattern", () => {
  const bpm = 128;
  const firstBeat = 0.137;
  const period = 60 / bpm;
  for (const table of [[1], [1, 0.3, 0.5, 0.3], [1, 0, 0.9, 0]]) {
    const hits = barPattern(bpm, table);
    const result = detectBeatGridWithDbnFromSamples(
      render(bpm, firstBeat, hits),
      SAMPLE_RATE,
      SECONDS,
    );
    assert.ok(result, `a grid was found for pattern ${table.join("/")}`);
    let error =
      (((result.offsetMs / 1000 - firstBeat) % (60 / result.bpm)) + 60 / result.bpm) %
      (60 / result.bpm);
    if (error > period / 2) {
      error -= 60 / result.bpm;
    }
    assert.ok(
      Math.abs(error) < 0.005,
      `pattern ${table.join("/")}: phase error ${(error * 1000).toFixed(1)} ms`,
    );
  }
});
