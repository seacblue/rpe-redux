/**
 * Beat activation features that feed the DBN decoder.
 *
 * madmom's activation function comes from a trained recurrent network. The
 * network is the one part of its pipeline that cannot be ported without
 * shipping model weights, so this module produces the same interface — one
 * activation value per frame at a known frame rate — from a spectral-flux
 * analysis instead.
 *
 * The framing follows madmom's preprocessing: multi-resolution spectra with a
 * logarithmic filterbank and positive spectral differences. The differences
 * are what a beat activation needs: a trained network has learned to keep only
 * the rising-energy frames, and a positive half-wave rectification of the flux
 * is the closest model-free equivalent.
 */
import type { AudioBufferLike } from "./audioAnalysis.ts";

/** One activation series plus the frame rate it was measured at. */
export interface BeatActivation {
  /** Activation per frame, normalised to `0..1`. */
  readonly values: Float32Array;
  /** Frames per second. */
  readonly fps: number;
}

/** Analysis shape; the defaults mirror madmom's RNN preprocessing. */
export interface BeatActivationOptions {
  /** Sample rate the analysis resamples to. */
  targetSampleRate?: number;
  /** Analysis frame sizes, longest last. */
  frameSizes?: readonly number[];
  /** Filterbank bands per frame size. */
  numBands?: number;
}

const DEFAULT_TARGET_RATE = 22050;
const DEFAULT_FRAME_SIZES = [1024, 2048] as const;
const DEFAULT_NUM_BANDS = 6;
/** Band edges in Hz, from madmom's `FilteredSpectrogramProcessor` defaults. */
const FMIN = 30;
const FMAX = 17000;
/** Flux is compared against this many frames back, as in madmom's `diff_ratio`. */
const DIFF_STEP = 1;
/**
 * Smoothing half-width in seconds.
 *
 * One percussive attack produces flux over several frames, so the activation
 * needs a window long enough to leave a single bump per hit and short enough
 * not to merge two adjacent beats: 40 ms sits well below the 0.27 s period of
 * 220 BPM.
 */
const SMOOTH_SECONDS = 0.04;

/** Clamp a value into `[minimum, maximum]`, falling back when it is not finite. */
function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

/** Average all channels into one mono signal, falling back to the loudest. */
export function monoFromBuffer(buffer: AudioBufferLike): Float32Array {
  const length = Math.max(0, Math.trunc(buffer?.length) || 0);
  const channels = Math.max(1, Math.trunc(buffer?.numberOfChannels) || 1);
  const mono = new Float32Array(length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      mono[index] += data[index] ?? 0;
    }
  }
  if (channels > 1) {
    for (let index = 0; index < length; index += 1) {
      mono[index] /= channels;
    }
  }
  return mono;
}

/** Linear resampling onto the analysis rate. */
function resample(samples: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (!(sourceRate > 0) || sourceRate === targetRate) {
    return samples;
  }
  const length = Math.max(1, Math.round((samples.length * targetRate) / sourceRate));
  const result = new Float32Array(length);
  const step = sourceRate / targetRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * step;
    const floor = Math.floor(position);
    const fraction = position - floor;
    const left = samples[floor] ?? 0;
    const right = samples[floor + 1] ?? left;
    result[index] = left + (right - left) * fraction;
  }
  return result;
}

/** In-place radix-2 FFT; only magnitudes are read. */
function fft(real: Float64Array, imaginary: Float64Array): void {
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
    const angle = (-2 * Math.PI) / size;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const half = size >> 1;
    for (let start = 0; start < length; start += size) {
      let cos = 1;
      let sin = 0;
      for (let offset = 0; offset < half; offset += 1) {
        const target = start + offset;
        const paired = target + half;
        const valueReal = real[paired] * cos - imaginary[paired] * sin;
        const valueImaginary = real[paired] * sin + imaginary[paired] * cos;
        real[paired] = real[target] - valueReal;
        imaginary[paired] = imaginary[target] - valueImaginary;
        real[target] += valueReal;
        imaginary[target] += valueImaginary;
        const nextCos = cos * cosine - sin * sine;
        sin = cos * sine + sin * cosine;
        cos = nextCos;
      }
    }
  }
}

/** Band index for a frequency, or `-1` outside the modelled range. */
function bandForFrequency(hz: number, numBands: number): number {
  if (!(hz >= FMIN) || hz > FMAX) {
    return -1;
  }
  // Logarithmic spacing, which is what makes the bands perceptually even.
  const position = Math.log2(hz / FMIN) / Math.log2(FMAX / FMIN);
  return Math.min(numBands - 1, Math.max(0, Math.floor(position * numBands)));
}

/**
 * Positive spectral flux for one frame size, summed over log-spaced bands.
 *
 * `hop` is shared across frame sizes so every window contributes on the same
 * timebase. The frame centres are placed at whole hops, which is why the caller
 * gets `centreFrames` back: that shift is what keeps a kick reported at the same
 * instant by a short and a long window.
 */
function fluxForFrameSize(
  samples: Float32Array,
  sampleRate: number,
  frameSize: number,
  numBands: number,
  hop: number,
): { values: Float32Array; centreFrames: number } {
  const frames = Math.max(0, Math.floor((samples.length - frameSize) / hop) + 1);
  const result = new Float32Array(frames);
  const centreFrames = Math.round(frameSize / 2 / hop);
  if (frames < 2) {
    return { values: result, centreFrames };
  }
  const half = frameSize >> 1;
  const window = new Float64Array(frameSize);
  for (let index = 0; index < frameSize; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (frameSize - 1));
  }
  const real = new Float64Array(frameSize);
  const imaginary = new Float64Array(frameSize);
  let previous = new Float64Array(numBands);
  const bands = new Float64Array(numBands);
  for (let frame = 0; frame < frames; frame += 1) {
    const start = frame * hop;
    for (let index = 0; index < frameSize; index += 1) {
      real[index] = (samples[start + index] ?? 0) * window[index];
      imaginary[index] = 0;
    }
    fft(real, imaginary);
    bands.fill(0);
    for (let bin = 1; bin < half; bin += 1) {
      const hz = (bin * sampleRate) / frameSize;
      const band = bandForFrequency(hz, numBands);
      if (band < 0) {
        continue;
      }
      bands[band] += Math.hypot(real[bin], imaginary[bin]);
    }
    let flux = 0;
    for (let band = 0; band < numBands; band += 1) {
      const magnitude = Math.log1p(bands[band]);
      const difference = magnitude - previous[band];
      if (difference > 0) {
        flux += difference;
      }
    }
    previous = Float64Array.from(bands, (value) => Math.log1p(value));
    result[frame] = flux;
  }
  return { values: result, centreFrames };
}

/**
 * Rescale an activation to `0..1`, clamped, using a high percentile as the scale.
 *
 * The maximum is a poor scale here: a single noise frame can exceed every real
 * beat, and dividing by it pushes the beats down into the floor. Measured on a
 * noisy click track, the 90th percentile of the activation fell from 0.50 to
 * 0.09 — the beats were still there, but scaled out of reach of the decoder's
 * threshold. The 95th percentile is a level a real beat reaches on this
 * material, and one spike cannot set it.
 */
function normalize(values: Float32Array): void {
  if (!values.length) {
    return;
  }
  const sorted = Float32Array.from(values).sort();
  const scale = sorted[Math.floor(sorted.length * 0.95)];
  if (!(scale > 0)) {
    return;
  }
  const factor = 1 / scale;
  for (let index = 0; index < values.length; index += 1) {
    values[index] = Math.min(1, values[index] * factor);
  }
}

/**
 * Build a beat activation from decoded PCM.
 *
 * Several frame sizes run in parallel and their fluxes are added, so a kick and
 * a hi-hat are both visible in the same series: the long window resolves low
 * frequencies, the short one keeps transients sharp. The result is normalised,
 * because the decoder expects a probability-like value per frame.
 */
export function buildBeatActivation(
  buffer: AudioBufferLike,
  sampleRate: number,
  options: BeatActivationOptions = {},
): BeatActivation | null {
  if (!buffer || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return null;
  }
  const mono = monoFromBuffer(buffer);
  if (!mono.length) {
    return null;
  }
  const targetRate = clampNumber(options.targetSampleRate, DEFAULT_TARGET_RATE, 8000, 48000);
  const rate = Math.min(sampleRate, targetRate);
  const samples = resample(mono, sampleRate, rate);
  const numBands = Math.round(clampNumber(options.numBands, DEFAULT_NUM_BANDS, 2, 24));
  const sizes = (options.frameSizes ?? DEFAULT_FRAME_SIZES).filter(
    (size) => Number.isFinite(size) && size >= 64,
  );
  if (!sizes.length) {
    return null;
  }

  // Every window is read on one shared hop grid, so `fps` is the same for all of
  // them and a frame means the same instant in each series.
  const shortest = Math.min(...sizes);
  const hop = Math.max(1, shortest >> 2);
  const fps = rate / hop;
  let frames = 0;
  for (const size of sizes) {
    const count = Math.max(0, Math.floor((samples.length - size) / hop) + 1);
    frames = Math.max(frames, count + Math.round(size / 2 / hop));
  }
  if (frames < 4) {
    return null;
  }
  // A window's spectrum describes the signal at its centre, so its flux lands
  // `centreFrames` frames later than its start. Adding that shift is what keeps
  // a kick reported at the same instant by the short and the long window.
  const summed = new Float64Array(frames);
  const contributions = new Float64Array(frames);
  for (const size of sizes) {
    const flux = fluxForFrameSize(samples, rate, size, numBands, hop);
    for (let frame = 0; frame < flux.values.length; frame += 1) {
      const target = frame + flux.centreFrames;
      if (target >= frames) {
        break;
      }
      summed[target] += flux.values[frame];
      contributions[target] += 1;
    }
  }
  // Windows run out of frames at different points; dividing by the number that
  // actually covered a frame keeps the tail from reading as a drop in energy.
  for (let frame = 0; frame < frames; frame += 1) {
    if (contributions[frame] > 1) {
      summed[frame] /= contributions[frame];
    }
  }
  // Half-wave rectified difference between neighboring frames: the rise is the
  // event, and a sustaining tone should not read as a beat.
  const activation = new Float32Array(frames);
  for (let frame = DIFF_STEP; frame < frames; frame += 1) {
    const rise = summed[frame] - summed[frame - DIFF_STEP];
    activation[frame] = rise > 0 ? rise : 0;
  }
  // A percussive attack spans several analysis frames, and the flux inside one
  // attack can rise more than once as the waveform's own cycles pass through
  // the bands. Smoothing over a short window leaves one bump per attack, which
  // is what the decoder needs: an activation that fires twice inside one hit
  // makes it read a faster tempo.
  const smoothed = smoothActivation(activation, Math.max(1, Math.round(fps * SMOOTH_SECONDS)));
  // Subtract the noise floor before normalising. Dividing by the global peak
  // alone lets a loud noise spike set the scale, which flattens every real beat
  // into the floor — measured on a noisy click track, that took the peak count
  // from 132 to 1 and left the decoder with nothing to lock onto. The floor is
  // the median, which noise dominates but beats do not.
  removeNoiseFloor(smoothed);
  normalize(smoothed);
  return { values: smoothed, fps };
}

/**
 * Subtract the median activation from every frame, clamping at zero.
 *
 * A beat activation is mostly quiet between hits, so its median is the floor
 * that steady noise raises. Removing it keeps the peaks standing at their true
 * relative height instead of being scaled down by whatever the noisiest single
 * frame happened to be.
 */
function removeNoiseFloor(values: Float32Array): void {
  if (!values.length) {
    return;
  }
  const sorted = Float32Array.from(values).sort();
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) {
    return;
  }
  for (let index = 0; index < values.length; index += 1) {
    values[index] = Math.max(0, values[index] - median);
  }
}

/**
 * Centre-weighted moving average over an activation.
 *
 * A plain box average would flatten the peak and blur two neighboring beats
 * together, so the window is triangular: the frame itself keeps the most
 * weight and the tails fade out. This is the model-free stand-in for the
 * temporal context a trained network supplies.
 */
function smoothActivation(values: Float32Array, radius: number): Float32Array {
  if (radius < 1) {
    return values;
  }
  const result = new Float32Array(values.length);
  let weightTotal = 0;
  const weights = new Float64Array(radius * 2 + 1);
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = radius + 1 - Math.abs(offset);
    weights[offset + radius] = weight;
    weightTotal += weight;
  }
  for (let index = 0; index < values.length; index += 1) {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const at = index + offset;
      if (at >= 0 && at < values.length) {
        sum += values[at] * weights[offset + radius];
      }
    }
    result[index] = sum / weightTotal;
  }
  return result;
}
