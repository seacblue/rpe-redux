/*
 * Learned fixed-tempo evidence for automatic timing detection.
 *
 * The model supplies beat activation, not a BPM answer. This module owns the
 * browser-side log-mel frontend, ONNX inference, and continuous fixed-grid
 * search; raw attack fitting remains in beatDetection.ts so the final result
 * keeps sub-frame timing precision.
 */
import type { BeatDetectionResult } from "../../../../../core/media/beatDetection.ts";
import { refineFixedTimingFromSamples } from "../../../../../core/media/beatDetection.ts";

const MODEL_PATH = "/assets/redux/models/beat_this_small0.onnx";
const SAMPLE_RATE = 22050;
const FFT_SIZE = 1024;
const HOP_SIZE = 441;
const MEL_BINS = 128;
const F_MIN = 30;
const F_MAX = 11000;
const FRAME_RATE = SAMPLE_RATE / HOP_SIZE;
const LOG_MULTIPLIER = 1000;
const SEARCH_SPAN = 0.04;
const SEARCH_STEP = 0.1;
const SEARCH_PHASES = 24;
const REFINEMENT_SPAN = 0.15;
const REFINEMENT_STEP = 0.01;
const REFINEMENT_PHASES = 48;

type OrtModule = typeof import("onnxruntime-web");
type OrtSession = import("onnxruntime-web").InferenceSession;

let sessionPromise: Promise<{ ort: OrtModule; session: OrtSession }> | null = null;

interface TimingCandidate {
  bpm: number;
  phaseFrames: number;
  score: number;
}

/** Clamp a finite number to an inclusive range. */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

/** Return a Hann window matching torch.hann_window's periodic default. */
function periodicHann(size: number): Float64Array {
  const window = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
  }
  return window;
}

/** Reflect an index using torch's pad_mode="reflect" convention. */
function reflectedIndex(index: number, length: number): number {
  if (length <= 1) {
    return 0;
  }
  let result = index;
  while (result < 0 || result >= length) {
    result = result < 0 ? -result : 2 * length - 2 - result;
  }
  return result;
}

/** Resample mono PCM onto Beat This's 22050 Hz input rate. */
function resample(samples: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === SAMPLE_RATE) {
    return samples;
  }
  const length = Math.max(1, Math.round((samples.length * SAMPLE_RATE) / sourceRate));
  const result = new Float32Array(length);
  const step = sourceRate / SAMPLE_RATE;
  for (let index = 0; index < length; index += 1) {
    const position = index * step;
    const leftIndex = Math.floor(position);
    const fraction = position - leftIndex;
    const left = samples[leftIndex] ?? 0;
    const right = samples[leftIndex + 1] ?? left;
    result[index] = left + (right - left) * fraction;
  }
  return result;
}

/** Build Beat This's Slaney frequency scale in mels. */
function hzToMel(hz: number): number {
  const linearStep = 200 / 3;
  const linearLimit = 1000;
  const linearMels = linearLimit / linearStep;
  const logStep = Math.log(6.4) / 27;
  return hz < linearLimit ? hz / linearStep : linearMels + Math.log(hz / linearLimit) / logStep;
}

/** Convert a Beat This mel coordinate back to Hz. */
function melToHz(mel: number): number {
  const linearStep = 200 / 3;
  const linearLimit = 1000;
  const linearMels = linearLimit / linearStep;
  const logStep = Math.log(6.4) / 27;
  return mel < linearMels ? mel * linearStep : linearLimit * Math.exp(logStep * (mel - linearMels));
}

/** Create torchaudio's unnormalised Slaney triangular filterbank. */
function buildMelBank(): Float64Array {
  const points = new Float64Array(MEL_BINS + 2);
  const minimum = hzToMel(F_MIN);
  const maximum = hzToMel(F_MAX);
  const binHz = SAMPLE_RATE / FFT_SIZE;
  for (let index = 0; index < points.length; index += 1) {
    const mel = minimum + ((maximum - minimum) * index) / (MEL_BINS + 1);
    points[index] = melToHz(mel) / binHz;
  }
  const bank = new Float64Array((FFT_SIZE / 2 + 1) * MEL_BINS);
  for (let mel = 0; mel < MEL_BINS; mel += 1) {
    const left = points[mel];
    const centre = points[mel + 1];
    const right = points[mel + 2];
    for (
      let bin = Math.max(0, Math.floor(left));
      bin <= Math.min(FFT_SIZE / 2, Math.ceil(right));
      bin += 1
    ) {
      const rising = centre > left ? (bin - left) / (centre - left) : 0;
      const falling = right > centre ? (right - bin) / (right - centre) : 0;
      bank[bin * MEL_BINS + mel] = Math.max(0, Math.min(rising, falling));
    }
  }
  return bank;
}

/** Perform an in-place radix-2 real FFT and leave its one-sided magnitude. */
function fftMagnitude(real: Float64Array, imaginary: Float64Array): void {
  const length = real.length;
  for (let index = 1, reverse = 0; index < length; index += 1) {
    let bit = length >> 1;
    for (; reverse & bit; bit >>= 1) {
      reverse ^= bit;
    }
    reverse ^= bit;
    if (index < reverse) {
      [real[index], real[reverse]] = [real[reverse], real[index]];
      [imaginary[index], imaginary[reverse]] = [imaginary[reverse], imaginary[index]];
    }
  }
  for (let size = 2; size <= length; size <<= 1) {
    const half = size >> 1;
    const angle = (-2 * Math.PI) / size;
    for (let start = 0; start < length; start += size) {
      for (let offset = 0; offset < half; offset += 1) {
        const cosine = Math.cos(angle * offset);
        const sine = Math.sin(angle * offset);
        const target = start + offset;
        const paired = target + half;
        const pairedReal = real[paired] * cosine - imaginary[paired] * sine;
        const pairedImaginary = real[paired] * sine + imaginary[paired] * cosine;
        real[paired] = real[target] - pairedReal;
        imaginary[paired] = imaginary[target] - pairedImaginary;
        real[target] += pairedReal;
        imaginary[target] += pairedImaginary;
      }
    }
  }
  for (let index = 0; index <= length / 2; index += 1) {
    real[index] = Math.hypot(real[index], imaginary[index]) / Math.sqrt(FFT_SIZE);
  }
}

/** Convert PCM to the time-major log-mel tensor expected by Beat This. */
function buildLogMel(
  samples: Float32Array,
  sourceRate: number,
): { values: Float32Array; frames: number } {
  const waveform = resample(samples, sourceRate);
  const frames = Math.max(1, Math.floor(waveform.length / HOP_SIZE) + 1);
  const bank = buildMelBank();
  const window = periodicHann(FFT_SIZE);
  const real = new Float64Array(FFT_SIZE);
  const imaginary = new Float64Array(FFT_SIZE);
  const values = new Float32Array(frames * MEL_BINS);
  const paddedStart = -FFT_SIZE / 2;
  for (let frame = 0; frame < frames; frame += 1) {
    const start = paddedStart + frame * HOP_SIZE;
    for (let index = 0; index < FFT_SIZE; index += 1) {
      const source = reflectedIndex(start + index, waveform.length);
      real[index] = (waveform[source] ?? 0) * window[index];
      imaginary[index] = 0;
    }
    fftMagnitude(real, imaginary);
    for (let mel = 0; mel < MEL_BINS; mel += 1) {
      let energy = 0;
      for (let bin = 0; bin <= FFT_SIZE / 2; bin += 1) {
        energy += real[bin] * bank[bin * MEL_BINS + mel];
      }
      values[frame * MEL_BINS + mel] = Math.log1p(LOG_MULTIPLIER * Math.max(0, energy));
    }
  }
  return { values, frames };
}

/** Load the local ONNX teacher session once per worker. */
async function loadSession(): Promise<{ ort: OrtModule; session: OrtSession }> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await import("onnxruntime-web");
      const wasm = new URL("onnxruntime-web/ort-wasm-simd-threaded.wasm?url", import.meta.url);
      ort.env.wasm.wasmPaths = { wasm: wasm.toString() };
      const response = await fetch(new URL(MODEL_PATH, globalThis.location.href));
      if (!response.ok) {
        throw new Error(`Beat model request failed: ${response.status}`);
      }
      const session = await ort.InferenceSession.create(await response.arrayBuffer(), {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      return { ort, session };
    })();
  }
  return sessionPromise;
}

/** Read a linearly interpolated activation value at a fractional frame. */
function sampleActivation(values: Float32Array, position: number): number {
  if (position < 0 || position >= values.length) {
    return 0;
  }
  const left = Math.floor(position);
  const fraction = position - left;
  const first = values[left] ?? 0;
  const second = values[left + 1] ?? first;
  return first + (second - first) * fraction;
}

/** Score one fixed grid against learned beat activation. */
function scoreCandidate(values: Float32Array, bpm: number, phaseFrames: number): number {
  const period = (FRAME_RATE * 60) / bpm;
  const on: number[] = [];
  const off: number[] = [];
  for (let position = phaseFrames; position < values.length; position += period) {
    on.push(sampleActivation(values, position));
    off.push(sampleActivation(values, position + period / 2));
  }
  if (on.length < 4) {
    return Number.NEGATIVE_INFINITY;
  }
  const sorted = [...on].sort((left, right) => left - right);
  const upperQuartile = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
  const onMean = on.reduce((sum, value) => sum + value, 0) / on.length;
  const offMean = off.reduce((sum, value) => sum + value, 0) / off.length;
  return onMean - 0.35 * offMean + 0.1 * upperQuartile;
}

/** Search BPM and phase around the deterministic TS candidate. */
function searchLearnedGrid(values: Float32Array, centreBpm: number): TimingCandidate {
  let best: TimingCandidate = { bpm: centreBpm, phaseFrames: 0, score: Number.NEGATIVE_INFINITY };
  for (
    let bpm = centreBpm * (1 - SEARCH_SPAN);
    bpm <= centreBpm * (1 + SEARCH_SPAN) + Number.EPSILON;
    bpm += SEARCH_STEP
  ) {
    const period = (FRAME_RATE * 60) / bpm;
    for (let phase = 0; phase < SEARCH_PHASES; phase += 1) {
      const phaseFrames = (period * phase) / SEARCH_PHASES;
      const score = scoreCandidate(values, bpm, phaseFrames);
      if (score > best.score) {
        best = { bpm, phaseFrames, score };
      }
    }
  }
  const start = Math.max(centreBpm * (1 - SEARCH_SPAN), best.bpm - REFINEMENT_SPAN);
  const end = Math.min(centreBpm * (1 + SEARCH_SPAN), best.bpm + REFINEMENT_SPAN);
  for (let bpm = start; bpm <= end + Number.EPSILON; bpm += REFINEMENT_STEP) {
    const period = (FRAME_RATE * 60) / bpm;
    const phaseStart = Math.max(0, best.phaseFrames - period / SEARCH_PHASES);
    const phaseEnd = Math.min(period, best.phaseFrames + period / SEARCH_PHASES);
    for (let phase = 0; phase < REFINEMENT_PHASES; phase += 1) {
      const phaseFrames = phaseStart + ((phaseEnd - phaseStart) * phase) / (REFINEMENT_PHASES - 1);
      const score = scoreCandidate(values, bpm, phaseFrames);
      if (score > best.score) {
        best = { bpm, phaseFrames, score };
      }
    }
  }
  return best;
}

/** Run one ONNX inference and return the frame-level beat activation. */
async function inferBeatActivation(
  samples: Float32Array,
  sampleRate: number,
): Promise<Float32Array> {
  const { values, frames } = buildLogMel(samples, sampleRate);
  const { ort, session } = await loadSession();
  const input = new ort.Tensor("float32", values, [1, frames, MEL_BINS]);
  const output = await session.run({ mel: input });
  const tensor = output.beat_logits ?? Object.values(output)[0];
  if (!tensor) {
    throw new Error("Beat model returned no activation");
  }
  const logits = Float32Array.from(tensor.data as Iterable<number>);
  const activation = new Float32Array(logits.length);
  for (let index = 0; index < logits.length; index += 1) {
    activation[index] = 1 / (1 + Math.exp(-logits[index]));
  }
  return activation;
}

/** Build the final beat-time preview for a learned fixed grid. */
function beatTimes(bpm: number, offsetMs: number, duration: number): Float32Array {
  const period = 60 / bpm;
  const result: number[] = [];
  for (let time = offsetMs / 1000; time < duration; time += period) {
    if (time >= 0) {
      result.push(time);
    }
  }
  return Float32Array.from(result);
}

/**
 * Refine the deterministic timing result with learned beat evidence.
 *
 * Model loading or preprocessing errors return `null` so the caller can keep
 * the existing TypeScript detector as a safe local fallback.
 */
export async function detectLearnedFixedTimingFromSamples(
  samples: Float32Array,
  sampleRate: number,
  duration: number,
  baseline: BeatDetectionResult,
): Promise<BeatDetectionResult | null> {
  if (!samples.length || !(sampleRate > 0) || !(baseline.bpm > 0)) {
    return null;
  }
  try {
    const activation = await inferBeatActivation(samples, sampleRate);
    const candidate = searchLearnedGrid(activation, clamp(baseline.bpm, 40, 360));
    if (!(candidate.score > Number.NEGATIVE_INFINITY)) {
      return null;
    }
    const initialOffsetMs = (candidate.phaseFrames / FRAME_RATE) * 1000;
    const refined = refineFixedTimingFromSamples(
      samples,
      sampleRate,
      candidate.bpm,
      initialOffsetMs,
      duration,
    );
    const bpm = refined?.bpm ?? candidate.bpm;
    const offsetMs = refined?.offsetMs ?? initialOffsetMs;
    return {
      ...baseline,
      bpm,
      offsetMs,
      duration,
      beatTimes: beatTimes(bpm, offsetMs, duration),
    };
  } catch {
    return null;
  }
}
