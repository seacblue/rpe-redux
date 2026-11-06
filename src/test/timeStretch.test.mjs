/**
 * WSOLA time-stretch regression: duration, pitch, seam continuity, envelope,
 * stereo phase, transient handling, and per-quantum render cost.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { TimeStretch, detectTransients } from "../core/media/timeStretchCore.ts";

const SAMPLE_RATE = 48_000;
const RATES = [0.25, 0.5, 0.75];

/** Render `seconds` of one mono stretcher output and return it. */
function render(stretch, seconds) {
  const frames = Math.round(SAMPLE_RATE * seconds);
  const output = new Float32Array(frames);
  let written = 0;
  while (written < frames) {
    const step = stretch.render([output.subarray(written)], frames - written, 0);
    if (step <= 0) {
      break;
    }
    written += step;
  }
  return output.subarray(0, written);
}

/** Render arbitrary channel counts and return one array per channel. */
function renderChannels(stretch, seconds, channels) {
  const frames = Math.round(SAMPLE_RATE * seconds);
  const output = Array.from({ length: channels }, () => new Float32Array(frames));
  let written = 0;
  while (written < frames) {
    const views = output.map((channel) => channel.subarray(written));
    const step = stretch.render(views, frames - written, 0);
    if (step <= 0) {
      break;
    }
    written += step;
  }
  return output.map((channel) => channel.subarray(0, written));
}

/** Index of the largest absolute sample in a range. */
function peakIndex(samples, from = 0, to = samples.length) {
  let peak = 0;
  let index = from;
  for (let sample = from; sample < to; sample += 1) {
    const value = Math.abs(samples[sample]);
    if (value > peak) {
      peak = value;
      index = sample;
    }
  }
  return index;
}

/** In-place iterative FFT magnitude for a real, Hann-windowed input. */
function fftMagnitude(samples, size) {
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    const window = 0.5 - 0.5 * Math.cos((Math.PI * 2 * index) / (size - 1));
    real[index] = (samples[index] ?? 0) * window;
  }
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reversed & bit; bit >>= 1) {
      reversed ^= bit;
    }
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }
  for (let block = 2; block <= size; block <<= 1) {
    const half = block >> 1;
    const angle = (-Math.PI * 2) / block;
    for (let start = 0; start < size; start += block) {
      for (let offset = 0; offset < half; offset += 1) {
        const cosine = Math.cos(angle * offset);
        const sine = Math.sin(angle * offset);
        const a = start + offset;
        const b = a + half;
        const br = real[b] * cosine - imaginary[b] * sine;
        const bi = real[b] * sine + imaginary[b] * cosine;
        real[b] = real[a] - br;
        imaginary[b] = imaginary[a] - bi;
        real[a] += br;
        imaginary[a] += bi;
      }
    }
  }
  const magnitude = new Float64Array(size / 2);
  for (let index = 0; index < size / 2; index += 1) {
    magnitude[index] = Math.hypot(real[index], imaginary[index]);
  }
  return magnitude;
}

/** Interpolated FFT peak frequency for a window of samples. */
function peakFrequency(samples, from, size, sampleRate) {
  const magnitude = fftMagnitude(samples.subarray(from, from + size), size);
  let peak = 1;
  for (let index = 2; index < magnitude.length; index += 1) {
    if (magnitude[index] > magnitude[peak]) {
      peak = index;
    }
  }
  const left = magnitude[peak - 1] ?? 0;
  const center = magnitude[peak];
  const right = magnitude[peak + 1] ?? 0;
  const denominator = left - 2 * center + right;
  const rawShift = denominator === 0 ? 0 : (0.5 * (left - right)) / denominator;
  const shift = Number.isFinite(rawShift) ? Math.max(-0.5, Math.min(0.5, rawShift)) : 0;
  return ((peak + shift) * sampleRate) / size;
}

/** Short-time RMS values with a fixed window and hop. */
function rmsWindows(samples, sampleRate, windowMs, hopMs) {
  const window = Math.max(8, Math.round((sampleRate * windowMs) / 1000));
  const hop = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const values = [];
  for (let start = 0; start + window <= samples.length; start += hop) {
    let energy = 0;
    for (let index = start; index < start + window; index += 1) {
      energy += samples[index] * samples[index];
    }
    values.push(Math.sqrt(energy / window));
  }
  return values;
}

/** Coefficient of variation and largest adjacent dB step for an envelope. */
function envelopeMetrics(samples, sampleRate) {
  const margin = Math.min(Math.round(sampleRate * 0.25), Math.floor(samples.length / 4));
  const envelope = rmsWindows(
    samples.subarray(margin, samples.length - margin),
    sampleRate,
    50,
    25,
  );
  const mean = envelope.reduce((sum, value) => sum + value, 0) / envelope.length;
  const variance = envelope.reduce((sum, value) => sum + (value - mean) ** 2, 0) / envelope.length;
  let maxStep = 0;
  for (let index = 1; index < envelope.length; index += 1) {
    maxStep = Math.max(maxStep, Math.abs(20 * Math.log10(envelope[index] / envelope[index - 1])));
  }
  return { cv: Math.sqrt(variance) / mean, maxStepDb: maxStep };
}

/** Correlation coefficient between two equally long signals. */
function correlation(left, right) {
  let dot = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    dot += left[index] * right[index];
    leftEnergy += left[index] * left[index];
    rightEnergy += right[index] * right[index];
  }
  return dot / Math.sqrt(leftEnergy * rightEnergy);
}

test("the first batch keeps an onset at sample zero", () => {
  const channel = new Float32Array(SAMPLE_RATE);
  for (let index = 0; index < 96; index += 1) {
    channel[index] = Math.exp(-index / 12) * (index % 2 ? -1 : 1);
  }
  for (const rate of [1, 0.5, 0.25]) {
    const stretch = new TimeStretch({
      channels: [channel],
      sampleRate: SAMPLE_RATE,
      rate,
      positionSeconds: 0,
    });
    stretch.prime();
    const output = render(stretch, 0.02);
    let peak = 0;
    for (let index = 0; index < 96; index += 1) {
      peak = Math.max(peak, Math.abs(output[index] ?? 0));
    }
    assert.ok(peak > 0.99, `rate ${rate} attenuated the first onset to ${peak}`);
  }
});

test("1x preserves decoded samples across render quanta even with detected transients", () => {
  const channel = new Float32Array(SAMPLE_RATE);
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] = Math.sin(index * 0.13) * 0.06 + Math.sin(index * 0.017) * 0.02;
  }
  const attack = Math.round(SAMPLE_RATE * 0.4);
  for (let index = 0; index < 480; index += 1) {
    channel[attack + index] += 0.8 * Math.exp(-index / 60) * (index % 2 ? -1 : 1);
  }
  const channels = [channel, channel.map((sample) => -sample / 2)];
  const transients = detectTransients(channels, SAMPLE_RATE);
  assert.ok(transients.some((sample) => Math.abs(sample - attack) < 128));
  const seekFrame = 207;
  const stretch = new TimeStretch({
    channels,
    sampleRate: SAMPLE_RATE,
    rate: 1,
    positionSeconds: seekFrame / SAMPLE_RATE,
    transients,
  });
  stretch.prime();
  const offset = 9;
  const quantum = channels.map(() => new Float32Array(128));
  let frame = seekFrame;
  let written;
  while ((written = stretch.render(quantum, 128 - offset, offset)) > 0) {
    for (let channel = 0; channel < channels.length; channel += 1) {
      assert.deepEqual(
        quantum[channel].subarray(offset, offset + written),
        channels[channel].subarray(frame, frame + written),
      );
    }
    frame += written;
  }
  assert.equal(frame, channel.length);
});

test("slow rates keep a transient near its expected output time", () => {
  const seconds = 6;
  const channel = new Float32Array(SAMPLE_RATE * seconds);
  const clickAt = SAMPLE_RATE;
  for (let index = 0; index < 480; index += 1) {
    channel[clickAt + index] = Math.exp(-index / 20) * (index % 2 ? -1 : 1);
  }
  const transients = detectTransients([channel], SAMPLE_RATE);
  for (const [rate, tolerance] of [
    [0.5, 0.04],
    [0.25, 0.1],
  ]) {
    const stretch = new TimeStretch({
      channels: [channel],
      sampleRate: SAMPLE_RATE,
      rate,
      positionSeconds: 0,
      transients,
    });
    stretch.prime();
    const output = render(stretch, 8);
    const peak = peakIndex(output);
    const expected = clickAt / SAMPLE_RATE / rate;
    const error = peak / SAMPLE_RATE - expected;
    assert.ok(
      Math.abs(error) <= tolerance,
      `rate ${rate} transient drifted ${(error * 1000).toFixed(1)}ms`,
    );
  }
});

test("slow rates produce the requested duration at 44.1k and 48k", () => {
  for (const sampleRate of [44_100, 48_000]) {
    const inputFrames = Math.round(sampleRate * 1.5);
    const left = new Float32Array(inputFrames);
    const right = new Float32Array(inputFrames);
    for (let index = 0; index < inputFrames; index += 1) {
      left[index] = 0.3 * Math.sin((2 * Math.PI * 220 * index) / sampleRate);
      right[index] = 0.2 * Math.sin((2 * Math.PI * 330 * index) / sampleRate + 0.4);
    }
    for (const rate of RATES) {
      const channels = rate === 0.5 ? [left, right] : [right];
      const stretch = new TimeStretch({
        channels,
        sampleRate,
        rate,
        positionSeconds: 0,
      });
      stretch.prime();
      let frames = 0;
      const quantum = channels.map(() => new Float32Array(128));
      for (;;) {
        const written = stretch.render(quantum, 128);
        if (written <= 0) {
          break;
        }
        frames += written;
      }
      const expected = inputFrames / rate;
      assert.ok(
        Math.abs(frames - expected) <= expected * 0.01,
        `${sampleRate} Hz rate ${rate} produced ${frames} frames, expected ${expected}`,
      );
    }
  }
});

test("slow rates preserve a 440 Hz tone within two cents", () => {
  const input = new Float32Array(SAMPLE_RATE * 2);
  for (let index = 0; index < input.length; index += 1) {
    input[index] = 0.3 * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE);
  }
  const size = 32_768;
  for (const rate of RATES) {
    const stretch = new TimeStretch({
      channels: [input],
      sampleRate: SAMPLE_RATE,
      rate,
      positionSeconds: 0,
    });
    stretch.prime();
    const output = renderChannels(stretch, input.length / SAMPLE_RATE / rate, 1)[0];
    assert.ok(output.length > size * 2, `rate ${rate} output is too short`);
    const from = Math.floor(output.length / 2 - size / 2);
    const frequency = peakFrequency(output, from, size, SAMPLE_RATE);
    const cents = Math.abs(1200 * Math.log2(frequency / 440));
    assert.ok(cents < 2, `rate ${rate} shifted the tone by ${cents.toFixed(2)} cents`);
  }
});

test("crossfade seams do not add clicks", () => {
  const input = new Float32Array(SAMPLE_RATE * 3);
  for (let index = 0; index < input.length; index += 1) {
    input[index] = 0.5 * Math.sin((2 * Math.PI * 55 * index) / SAMPLE_RATE);
  }
  for (const rate of RATES) {
    const stretch = new TimeStretch({
      channels: [input],
      sampleRate: SAMPLE_RATE,
      rate,
      positionSeconds: 0,
    });
    stretch.prime();
    const output = renderChannels(stretch, input.length / SAMPLE_RATE / rate, 1)[0];
    const batch = stretch.batchFrames;
    let maxJump = 0;
    for (let boundary = batch; boundary + batch < output.length; boundary += batch) {
      maxJump = Math.max(maxJump, Math.abs(output[boundary] - output[boundary - 1]));
    }
    assert.ok(maxJump < 0.02, `rate ${rate} seam jump was ${maxJump}`);
  }
});

test("a steady tone keeps a continuous envelope", () => {
  const input = new Float32Array(SAMPLE_RATE * 2);
  for (let index = 0; index < input.length; index += 1) {
    input[index] = 0.4 * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE);
  }
  for (const rate of RATES) {
    const stretch = new TimeStretch({
      channels: [input],
      sampleRate: SAMPLE_RATE,
      rate,
      positionSeconds: 0,
    });
    stretch.prime();
    const output = renderChannels(stretch, input.length / SAMPLE_RATE / rate, 1)[0];
    const metrics = envelopeMetrics(output, SAMPLE_RATE);
    assert.ok(metrics.cv < 0.02, `rate ${rate} envelope CV ${metrics.cv}`);
    assert.ok(metrics.maxStepDb < 1.5, `rate ${rate} envelope step ${metrics.maxStepDb} dB`);
  }
});

test("loud material stays finite and inside the output range", () => {
  const input = new Float32Array(SAMPLE_RATE * 2);
  let state = 7;
  for (let index = 0; index < input.length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const noise = (state / 0xffffffff) * 2 - 1;
    input[index] =
      0.5 * Math.sin((2 * Math.PI * 110 * index) / SAMPLE_RATE) +
      0.25 * Math.sin((2 * Math.PI * 330 * index) / SAMPLE_RATE) +
      0.1 * noise;
  }
  for (const rate of RATES) {
    const stretch = new TimeStretch({
      channels: [input, input.map((value) => value * 0.8)],
      sampleRate: SAMPLE_RATE,
      rate,
      positionSeconds: 0,
    });
    stretch.prime();
    const [left, right] = renderChannels(stretch, input.length / SAMPLE_RATE / rate, 2);
    for (const channel of [left, right]) {
      for (const value of channel) {
        assert.ok(Number.isFinite(value), `rate ${rate} produced a non-finite sample`);
        assert.ok(Math.abs(value) <= 1, `rate ${rate} produced a clipped sample ${value}`);
      }
    }
  }
});

test("anti-phase stereo stays anti-phase", () => {
  const input = new Float32Array(SAMPLE_RATE * 2);
  for (let index = 0; index < input.length; index += 1) {
    input[index] = 0.3 * Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE);
  }
  const inverted = input.map((value) => -value);
  for (const rate of RATES) {
    const stretch = new TimeStretch({
      channels: [input, inverted],
      sampleRate: SAMPLE_RATE,
      rate,
      positionSeconds: 0,
    });
    stretch.prime();
    const [left, right] = renderChannels(stretch, input.length / SAMPLE_RATE / rate, 2);
    const start = Math.min(left.length, SAMPLE_RATE) >> 1;
    const value = correlation(left.subarray(start), right.subarray(start));
    assert.ok(value < -0.999, `rate ${rate} stereo correlation ${value}`);
  }
});

test("detectTransients finds a synthetic onset", () => {
  const input = new Float32Array(SAMPLE_RATE);
  const clickAt = Math.round(SAMPLE_RATE * 0.6);
  for (let index = 0; index < 480; index += 1) {
    input[clickAt + index] = Math.exp(-index / 20) * (index % 2 ? -0.8 : 0.8);
  }
  const transients = detectTransients([input], SAMPLE_RATE);
  assert.ok(transients.length >= 1);
  assert.ok(
    Array.from(transients).some((sample) => Math.abs(sample - clickAt) < SAMPLE_RATE * 0.01),
  );
});

test("transient copies are replaced by a single attack", () => {
  const seconds = 3;
  const input = new Float32Array(SAMPLE_RATE * seconds);
  const clickAt = SAMPLE_RATE;
  for (let index = 0; index < 960; index += 1) {
    input[clickAt + index] = Math.exp(-index / 180) * (index % 2 ? -0.8 : 0.8);
  }
  const transients = detectTransients([input], SAMPLE_RATE);
  for (const rate of RATES) {
    const stretch = new TimeStretch({
      channels: [input],
      sampleRate: SAMPLE_RATE,
      rate,
      positionSeconds: 0,
      transients,
    });
    stretch.prime();
    const output = renderChannels(stretch, seconds / rate, 1)[0];
    const expected = clickAt / SAMPLE_RATE / rate;
    let copies = 0;
    let peak = 0;
    const from = Math.max(1, Math.round((expected - 0.15) * SAMPLE_RATE));
    const to = Math.min(output.length - 1, Math.round((expected + 0.15) * SAMPLE_RATE));
    for (let index = from; index < to; index += 1) {
      const value = Math.abs(output[index]);
      peak = Math.max(peak, value);
      if (
        value > 0.5 &&
        value >= Math.abs(output[index - 1]) &&
        value > Math.abs(output[index + 1])
      ) {
        copies += 1;
      }
    }
    assert.ok(peak > 0.7, `rate ${rate} lost the transient attack (${peak})`);
    assert.equal(copies, 1, `rate ${rate} produced ${copies} transient attacks`);
  }
});

test("slow playback keeps successive attacks on time and the tone between them steady", () => {
  const input = Float32Array.from(
    { length: SAMPLE_RATE * 4 },
    (_, index) => 0.1 * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE),
  );
  const attacks = Array.from({ length: 9 }, (_, index) =>
    Math.round((0.37 + index * 0.4) * SAMPLE_RATE),
  );
  for (const attack of attacks) {
    for (let index = 0; index < 300; index += 1) {
      const time = index / SAMPLE_RATE;
      input[attack + index] += 0.82 * Math.exp(-time * 1000) * Math.cos(2 * Math.PI * 6500 * time);
    }
  }
  const transients = detectTransients([input], SAMPLE_RATE);
  assert.equal(transients.length, attacks.length);
  for (const rate of [...RATES, 0.67]) {
    const stretch = new TimeStretch({
      channels: [input],
      sampleRate: SAMPLE_RATE,
      rate,
      positionSeconds: 0,
      transients,
    });
    const [output] = renderChannels(stretch, 4 / rate, 1);
    const peaks = [];
    let lastAttack = -Infinity;
    for (let index = 1; index < output.length; index += 1) {
      const edge = Math.abs(output[index] - output[index - 1]);
      if (edge < 0.55) {
        continue;
      }
      if (index - lastAttack > SAMPLE_RATE * 0.008) {
        peaks.push({ index, edge });
      } else if (edge > peaks.at(-1).edge) {
        peaks[peaks.length - 1] = { index, edge };
      }
      lastAttack = index;
    }
    assert.equal(peaks.length, attacks.length, `rate ${rate} produced ${peaks.length} attacks`);
    for (let index = 0; index < attacks.length; index += 1) {
      const driftMs = (1000 * (peaks[index].index - attacks[index] / rate)) / SAMPLE_RATE;
      assert.ok(Math.abs(driftMs) <= 5, `rate ${rate} attack ${index} drifted ${driftMs} ms`);
    }
    const windowFrames = SAMPLE_RATE * 0.01;
    const margin = SAMPLE_RATE * 0.1;
    for (
      let start = margin;
      start + windowFrames < output.length - margin;
      start += windowFrames / 2
    ) {
      if (attacks.some((attack) => Math.abs(start - attack / rate) < SAMPLE_RATE * 0.05)) {
        continue;
      }
      let energy = 0;
      for (let frame = start; frame < start + windowFrames; frame += 1) {
        energy += output[frame] ** 2;
      }
      const rms = Math.sqrt(energy / windowFrames);
      assert.ok(rms > 0.058 && rms < 0.09, `rate ${rate} changed the sustained tone to RMS ${rms}`);
    }
  }
});

test("slow playback keeps the body of identical kicks at a consistent level", () => {
  const kicks = Array.from({ length: 9 }, (_, index) => 0.37 + index * 0.4);
  const input = Float32Array.from(
    { length: SAMPLE_RATE * 4 },
    (_, index) => 0.06 * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE),
  );
  for (const kick of kicks) {
    const start = Math.round(kick * SAMPLE_RATE);
    for (let index = 0; index < SAMPLE_RATE * 0.15; index += 1) {
      const time = index / SAMPLE_RATE;
      const phase = 47 * time + 1.1 * (1 - Math.exp(-64 * time));
      input[start + index] += 0.78 * Math.exp(-39 * time) * Math.sin(2 * Math.PI * phase);
    }
  }
  const transients = detectTransients([input], SAMPLE_RATE);
  assert.equal(transients.length, kicks.length);
  for (const rate of RATES) {
    const stretch = new TimeStretch({
      channels: [input],
      sampleRate: SAMPLE_RATE,
      positionSeconds: 0,
      rate,
      transients,
    });
    const [output] = renderChannels(stretch, 4 / rate, 1);
    const levels = kicks.map((kick) => {
      const start = Math.round((kick / rate - 0.005) * SAMPLE_RATE);
      const window = output.subarray(start, start + 0.08 * SAMPLE_RATE);
      const energy = window.reduce((sum, sample) => sum + sample ** 2, 0);
      return 10 * Math.log10(energy / window.length);
    });
    const spread = Math.max(...levels) - Math.min(...levels);
    assert.ok(spread < 0.75, `rate ${rate} kick bodies varied by ${spread.toFixed(2)} dB`);
  }
});

test("nearby attacks take precedence over the previous kick body", () => {
  const input = Float32Array.from(
    { length: SAMPLE_RATE },
    (_, index) => 0.06 * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE),
  );
  for (let attack = 0; attack < 12; attack += 1) {
    const start = Math.round((0.31 + attack * 0.033) * SAMPLE_RATE);
    for (let index = 0; index < 300; index += 1) {
      const time = index / SAMPLE_RATE;
      input[start + index] += 0.82 * Math.exp(-time * 1000) * Math.cos(2 * Math.PI * 6500 * time);
    }
  }
  const transients = detectTransients([input], SAMPLE_RATE);
  assert.equal(transients.length, 12);
  for (const rate of RATES) {
    const stretch = new TimeStretch({
      channels: [input],
      sampleRate: SAMPLE_RATE,
      positionSeconds: 0,
      rate,
      transients,
    });
    const [output] = renderChannels(stretch, 1 / rate, 1);
    let count = 0;
    let lastAttack = -Infinity;
    for (let frame = 1; frame < output.length; frame += 1) {
      if (Math.abs(output[frame] - output[frame - 1]) > 0.45) {
        count += Number(frame - lastAttack > SAMPLE_RATE * 0.008);
        lastAttack = frame;
      }
    }
    assert.equal(count, 12, `rate ${rate} produced ${count} attacks`);
  }
});

test("one 128-frame quantum stays inside the realtime budget", () => {
  const input = new Float32Array(SAMPLE_RATE * 2);
  for (let index = 0; index < input.length; index += 1) {
    input[index] = 0.3 * Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE);
  }
  const stretch = new TimeStretch({
    channels: [input, input.map((value) => value * 0.8)],
    sampleRate: SAMPLE_RATE,
    rate: 0.25,
    positionSeconds: 0,
  });
  stretch.prime();
  const quantum = [new Float32Array(128), new Float32Array(128)];
  for (let index = 0; index < 100; index += 1) {
    stretch.render(quantum, 128);
  }
  const times = [];
  for (let index = 0; index < 500; index += 1) {
    const start = performance.now();
    if (stretch.render(quantum, 128) <= 0) {
      break;
    }
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)] ?? 0;
  assert.ok(p95 < 1.5, `p95 quantum cost was ${p95.toFixed(3)}ms`);
});
