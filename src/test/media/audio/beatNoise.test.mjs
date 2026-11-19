/**
 * Verify the activation and the attack refit survive broadband noise.
 *
 * Noise is what broke this detector in the field: the activation normalised by
 * its global peak let a noise spike set the scale, which flattened every real
 * beat, and the attack search accepted any rise inside its window, so a grid
 * offset by half a beat still reported full support. Both defects had the same
 * signature — the tempo stayed right while the phase drifted — so these tests
 * check phase and peak visibility directly, not just the tempo.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildBeatActivation } from "../../../core/media/beatActivation.ts";
import { detectBeatGridWithDbnFromSamples } from "../../../core/media/beatDetection.ts";

const SAMPLE_RATE = 44100;
const SECONDS = 24;

/** Deterministic noise so a failure reproduces. */
function seededNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** A click track with optional noise and a per-bar level table. */
function clickTrack(bpm, firstBeat, table, noise = 0) {
  const period = 60 / bpm;
  const samples = new Float32Array(Math.ceil(SECONDS * SAMPLE_RATE));
  const length = Math.round(0.05 * SAMPLE_RATE);
  const random = seededNoise(4242);
  for (let beat = 0; firstBeat + beat * period < SECONDS; beat += 1) {
    const level = table[beat % table.length];
    if (level === 0) {
      continue;
    }
    const start = Math.round((firstBeat + beat * period) * SAMPLE_RATE);
    for (let index = 0; index < length; index += 1) {
      const at = start + index;
      if (at >= samples.length) {
        break;
      }
      samples[at] +=
        Math.sin((2 * Math.PI * 65 * index) / SAMPLE_RATE) *
        Math.exp((-index / SAMPLE_RATE) * 70) *
        level;
    }
  }
  if (noise > 0) {
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] += (random() * 2 - 1) * noise;
    }
  }
  return samples;
}

/** Phase difference between a reported offset and the true first beat. */
function phaseErrorMs(offsetMs, reportedBpm, trueFirst) {
  const period = 60 / reportedBpm;
  let error = (((offsetMs / 1000 - trueFirst) % period) + period) % period;
  if (error > period / 2) {
    error -= period;
  }
  return error * 1000;
}

/** Count activation frames that stand clearly above the noise floor. */
function visiblePeaks(values) {
  let count = 0;
  for (let frame = 1; frame < values.length - 1; frame += 1) {
    if (
      values[frame] > 0.3 &&
      values[frame] >= values[frame - 1] &&
      values[frame] > values[frame + 1]
    ) {
      count += 1;
    }
  }
  return count;
}

test("noise does not flatten the activation", () => {
  // The peak count is the symptom that mattered: with the global-peak
  // normalisation alone, noise took it from over a hundred to one.
  const clean = clickTrack(128, 0.0837, [1], 0);
  const noisy = clickTrack(128, 0.0837, [1], 0.1);
  const cleanPeaks = visiblePeaks(
    buildBeatActivation(
      { length: clean.length, numberOfChannels: 1, duration: SECONDS, getChannelData: () => clean },
      SAMPLE_RATE,
    ).values,
  );
  const noisyPeaks = visiblePeaks(
    buildBeatActivation(
      { length: noisy.length, numberOfChannels: 1, duration: SECONDS, getChannelData: () => noisy },
      SAMPLE_RATE,
    ).values,
  );
  assert.ok(cleanPeaks > 30, `clean track shows ${cleanPeaks} peaks`);
  assert.ok(
    noisyPeaks > cleanPeaks * 0.5,
    `noise kept ${noisyPeaks} of ${cleanPeaks} peaks; the floor is not being removed`,
  );
});

test("noise does not move the measured phase", () => {
  const firstBeat = 0.211;
  for (const noise of [0, 0.03, 0.06, 0.1]) {
    for (const bpm of [100, 128, 190]) {
      const result = detectBeatGridWithDbnFromSamples(
        clickTrack(bpm, firstBeat, [1], noise),
        SAMPLE_RATE,
        SECONDS,
      );
      assert.ok(result, `${bpm} BPM at noise ${noise}: a grid was found`);
      assert.ok(
        Math.abs(result.bpm - bpm) < 0.01,
        `${bpm} BPM at noise ${noise}: measured ${result.bpm}`,
      );
      const error = phaseErrorMs(result.offsetMs, result.bpm, firstBeat);
      assert.ok(
        Math.abs(error) < 3,
        `${bpm} BPM at noise ${noise}: phase off by ${error.toFixed(2)} ms`,
      );
    }
  }
});

test("an accented pattern keeps its phase under noise", () => {
  for (const noise of [0, 0.06, 0.1]) {
    const firstBeat = 0.0837;
    const result = detectBeatGridWithDbnFromSamples(
      clickTrack(128, firstBeat, [1, 0.3, 0.5, 0.3], noise),
      SAMPLE_RATE,
      SECONDS,
    );
    assert.ok(result, `a grid was found at noise ${noise}`);
    assert.ok(Math.abs(result.bpm - 128) < 0.01, `measured ${result.bpm} at noise ${noise}`);
    const error = phaseErrorMs(result.offsetMs, result.bpm, firstBeat);
    assert.ok(Math.abs(error) < 3, `noise ${noise}: phase off by ${error.toFixed(2)} ms`);
  }
});

test("a sparse pattern under noise still produces a grid", () => {
  // Only every second beat carries a hit, so 24 s holds about 10 onsets. Under
  // noise there are too few attacks for the refit to resolve the period below
  // the decoder's frame quantisation, and the answer uses the decode as-is.
  // The requirement here is therefore "a usable grid, not an exact number":
  // returning nothing would leave the author with no starting point.
  for (const noise of [0, 0.03, 0.1]) {
    const result = detectBeatGridWithDbnFromSamples(
      clickTrack(100, 0.211, [1, 0, 1, 0], noise),
      SAMPLE_RATE,
      SECONDS,
    );
    assert.ok(result, `noise ${noise}: a grid was found rather than null`);
    assert.ok(
      result.bpm > 45 && result.bpm < 58,
      `noise ${noise}: measured ${result.bpm}, expected near the 50 BPM pulse`,
    );
  }
});

test("a sparse pattern without noise still reports the exact pulse", () => {
  const result = detectBeatGridWithDbnFromSamples(
    clickTrack(100, 0.211, [1, 0, 1, 0], 0),
    SAMPLE_RATE,
    SECONDS,
  );
  assert.ok(result, "a grid was found");
  assert.ok(Math.abs(result.bpm - 50) < 0.01, `measured ${result.bpm}`);
});
