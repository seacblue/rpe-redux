/**
 * Beat activation features, following madmom's `RNNBeatProcessor` preprocessing.
 *
 * madmom's activation comes from a trained network. The network is the one part
 * of the pipeline that cannot be shipped, so the features that feed it are
 * reproduced here exactly — signal handling, framing, STFT, logarithmic
 * filterbank, log compression and positive difference — and only the network
 * itself is replaced by a sum over bands.
 *
 * The chain, with madmom's own defaults:
 *
 * 1. `SignalProcessor(num_channels=1, sample_rate=44100)`
 * 2. for each frame size `[1024, 2048, 4096]`:
 *    `FramedSignalProcessor(frame_size)` → `ShortTimeFourierTransformProcessor()`
 *    → `FilteredSpectrogramProcessor(num_bands=6, fmin=30, fmax=17000,
 *    norm_filters=True)` → `LogarithmicSpectrogramProcessor(mul=1, add=1)`
 *    → `SpectrogramDifferenceProcessor(diff_ratio=0.5, positive_diffs=True)`
 * 3. stack the three difference matrices, as `np.hstack` does
 *
 * Three details matter more than they look:
 *
 * - **The filterbank is triangular and area-normalised.** Bands are spaced six
 *   per octave, so a band an octave above another spans twice the frequency
 *   range; dividing each filter by its own area keeps a wide high band from
 *   contributing more than a narrow low one. Without that normalisation the high
 *   bands dominate the flux, which is what made an earlier version here report
 *   two reference tracks at double their tempo.
 * - **`diff_ratio=0.5` sets a frame-size-dependent difference step.** The step is
 *   the distance, in frames, from the window centre to the first sample whose
 *   window value exceeds half the maximum. A long window therefore looks further
 *   back than a short one, which is what lets the three resolutions describe the
 *   same onset consistently.
 * - **The window is centred on each frame's reference sample**, as madmom's
 *   `signal_frame` does, so the three resolutions share one time axis and no
 *   shift is needed when they are combined.
 */
import type { AudioBufferLike } from "./audioAnalysis.ts";

/** One activation series plus the frame rate it was measured at. */
export interface BeatActivation {
  /** Activation per frame, normalised to `0..1`. */
  readonly values: Float32Array;
  /** Frames per second. */
  readonly fps: number;
}

/** Analysis shape; the defaults are madmom's RNN preprocessing defaults. */
export interface BeatActivationOptions {
  /** Sample rate the analysis resamples to; madmom fixes this at 44100. */
  targetSampleRate?: number;
  /** Analysis frame sizes, in samples. */
  frameSizes?: readonly number[];
  /** Filterbank bands per octave. */
  numBands?: number;
  /** Frames per second; madmom's front end runs at 100. */
  fps?: number;
  /**
   * Weight applied to each filterbank band, in band order.
   *
   * This is the stand-in for the input layer of madmom's network, which learns
   * how much each band may say about a beat. Without it every band contributes
   * equally after the filterbank's area normalisation, which gives the thirty
   * bands above 2 kHz — the cymbals and upper harmonics — more than half the
   * summed flux. Bands beyond the end of this array keep weight 1.
   */
  bandWeights?: readonly number[];
}

/** madmom `FilteredSpectrogramProcessor` defaults. */
const FMIN = 30;
const FMAX = 17000;
const NUM_BANDS_PER_OCTAVE = 6;
const A4 = 440;
/** madmom `RNNBeatProcessor` offline defaults. */
const DEFAULT_SAMPLE_RATE = 44100;
const DEFAULT_FRAME_SIZES = [1024, 2048, 4096] as const;
const DEFAULT_FPS = 100;
/** madmom `SpectrogramDifferenceProcessor` default. */
const DIFF_RATIO = 0.5;

/** One filterbank band: the FFT bins it spans and the weight of each. */
interface Band {
  /** First bin index inside the band. */
  start: number;
  /** Weight for each bin from `start`. */
  weights: Float64Array;
}

/** Clamp a value into `[minimum, maximum]`, falling back when it is not finite. */
function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

/** Average all channels into one mono signal, as `Signal(num_channels=1)` does. */
export function monoFromBuffer(buffer: AudioBufferLike): Float32Array {
  const length = Math.max(0, Math.trunc(buffer?.length) || 0);
  const channels = Math.max(1, Math.trunc(buffer?.numberOfChannels) || 1);
  if (channels === 1) {
    return Float32Array.from(buffer.getChannelData(0), (value) => value ?? 0);
  }
  const mono = new Float32Array(length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      mono[index] += data[index] ?? 0;
    }
  }
  const scale = 1 / channels;
  for (let index = 0; index < length; index += 1) {
    mono[index] *= scale;
  }
  return mono;
}

/** Linear resampling onto the analysis rate, standing in for madmom's ffmpeg call. */
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

/** In-place radix-2 FFT; magnitudes are all the filterbank reads. */
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

/** The Hann window madmom's STFT applies, sized to the frame. */
function hann(frameSize: number): Float64Array {
  const window = new Float64Array(frameSize);
  for (let index = 0; index < frameSize; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (frameSize - 1));
  }
  return window;
}

/**
 * Filterbank centre frequencies, as `log_frequencies` computes them.
 *
 * The band index range is widened to whole bands and then clipped to
 * `[fmin, fmax]`, which is what madmom's `floor`/`ceil` on the band indices
 * followed by two `searchsorted` calls does.
 */
function logFrequencies(numBands: number, fmin: number, fmax: number): number[] {
  const left = Math.floor(Math.log2(fmin / A4) * numBands);
  const right = Math.ceil(Math.log2(fmax / A4) * numBands);
  const frequencies: number[] = [];
  for (let index = left; index < right; index += 1) {
    const hz = A4 * 2 ** (index / numBands);
    if (hz >= fmin && hz <= fmax) {
      frequencies.push(hz);
    }
  }
  return frequencies;
}

/** FFT bin closest to a frequency, as `frequencies2bins` chooses it. */
function binForFrequency(hz: number, binHz: number, numBins: number): number {
  return Math.max(0, Math.min(numBins - 1, Math.round(hz / binHz)));
}

/**
 * Build madmom's logarithmic triangular filterbank for one FFT size.
 *
 * Each filter rises linearly from its lower neighbour bin to its centre and
 * falls to its upper neighbour, then is divided by its own sum. That
 * normalisation is what keeps high bands from dominating: at six bands per
 * octave the top band spans hundreds of bins while the bottom spans one, so an
 * unnormalised sum would weight the top band by two orders of magnitude more.
 */
function buildFilterbank(binHz: number, numBins: number, numBandsPerOctave: number): Band[] {
  const frequencies = logFrequencies(numBandsPerOctave, FMIN, FMAX);
  const bins = frequencies.map((hz) => binForFrequency(hz, binHz, numBins));
  // Duplicate bins come from the coarse resolution at low frequencies; madmom's
  // `unique_filters` removes them so no filter is built from a single bin.
  const unique = [...new Set(bins)].sort((left, right) => left - right);
  const bands: Band[] = [];
  for (let index = 0; index + 2 < unique.length; index += 1) {
    const start = unique[index];
    const centre = unique[index + 1];
    const stop = unique[index + 2];
    // madmom collapses a filter narrower than two bins to a single bin.
    if (stop - start < 2) {
      bands.push({ start, weights: Float64Array.from([1]) });
      continue;
    }
    const weights = new Float64Array(stop - start);
    for (let offset = 0; offset < centre - start; offset += 1) {
      weights[offset] = offset / (centre - start);
    }
    for (let offset = centre - start; offset < stop - start; offset += 1) {
      weights[offset] = 1 - (offset - (centre - start)) / (stop - centre);
    }
    let total = 0;
    for (const weight of weights) {
      total += weight;
    }
    if (total > 0) {
      for (let offset = 0; offset < weights.length; offset += 1) {
        weights[offset] /= total;
      }
    }
    bands.push({ start, weights });
  }
  return bands;
}

/**
 * Difference step in frames for one window and ratio.
 *
 * This is madmom's `_diff_frames`: find the first sample, measured from the
 * window centre, whose window value exceeds `diff_ratio` of the maximum, and
 * convert that distance to frames. A longer window gets a larger step, which is
 * why the three resolutions of `RNNBeatProcessor` look back by different
 * amounts.
 */
function diffFrames(diffRatio: number, hopSize: number, frameSize: number): number {
  const window = hann(frameSize);
  let maximum = 0;
  for (const value of window) {
    if (value > maximum) {
      maximum = value;
    }
  }
  let sample = 0;
  while (sample < frameSize && !(window[sample] > diffRatio * maximum)) {
    sample += 1;
  }
  return Math.max(1, Math.round((frameSize / 2 - sample) / hopSize));
}

/** Filtered, log-compressed, positive-difference spectrogram for one frame size. */
function differenceForFrameSize(
  samples: Float32Array,
  sampleRate: number,
  frameSize: number,
  hopSize: number,
  numBandsPerOctave: number,
): { values: Float32Array; frames: number; bands: number } {
  const frames = Math.ceil(samples.length / hopSize);
  const half = frameSize >> 1;
  const bins = frameSize >> 1;
  const bands = buildFilterbank(sampleRate / frameSize, bins, numBandsPerOctave);
  const window = hann(frameSize);
  const real = new Float64Array(frameSize);
  const imaginary = new Float64Array(frameSize);

  // Filtered spectrogram values, log10(x + 1) as madmom's logarithmic scaling.
  const filtered = new Float64Array(frames * bands.length);
  for (let frame = 0; frame < frames; frame += 1) {
    // `signal_frame` centres the window on the frame's reference sample.
    const start = Math.round(frame * hopSize) - half;
    for (let index = 0; index < frameSize; index += 1) {
      const at = start + index;
      real[index] = at >= 0 && at < samples.length ? (samples[at] ?? 0) * window[index] : 0;
      imaginary[index] = 0;
    }
    fft(real, imaginary);
    const row = frame * bands.length;
    for (let band = 0; band < bands.length; band += 1) {
      const definition = bands[band];
      let sum = 0;
      for (let offset = 0; offset < definition.weights.length; offset += 1) {
        const bin = definition.start + offset;
        if (bin >= bins) {
          break;
        }
        sum += Math.hypot(real[bin], imaginary[bin]) * definition.weights[offset];
      }
      filtered[row + band] = Math.log10(sum + 1);
    }
  }

  // Positive difference with this frame size's own step.
  const step = diffFrames(DIFF_RATIO, hopSize, frameSize);
  const values = new Float32Array(frames * bands.length);
  for (let frame = step; frame < frames; frame += 1) {
    for (let band = 0; band < bands.length; band += 1) {
      const difference =
        filtered[frame * bands.length + band] - filtered[(frame - step) * bands.length + band];
      values[frame * bands.length + band] = difference > 0 ? difference : 0;
    }
  }
  return { values, frames, bands: bands.length };
}

/**
 * Build a beat activation from decoded PCM by madmom's preprocessing chain.
 *
 * The three resolutions are summed per frame, matching `np.hstack` followed by
 * the network's input layer summing across bands. A network learns *which* bands
 * predict a beat; a plain sum is the model-free stand-in, and it is the only
 * step here without an upstream equivalent.
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
  const targetRate = clampNumber(options.targetSampleRate, DEFAULT_SAMPLE_RATE, 8000, 48000);
  const rate = Math.min(sampleRate, targetRate);
  const samples = resample(mono, sampleRate, rate);
  const fps = clampNumber(options.fps, DEFAULT_FPS, 10, 1000);
  const hopSize = rate / fps;
  const numBandsPerOctave = Math.round(clampNumber(options.numBands, NUM_BANDS_PER_OCTAVE, 1, 24));
  const sizes = (options.frameSizes ?? DEFAULT_FRAME_SIZES).filter(
    (size) => Number.isFinite(size) && size >= 64,
  );
  if (!sizes.length) {
    return null;
  }

  let frames = 0;
  const differences: { values: Float32Array; bands: number }[] = [];
  for (const size of sizes) {
    const result = differenceForFrameSize(samples, rate, size, hopSize, numBandsPerOctave);
    if (!result.bands) {
      continue;
    }
    differences.push({ values: result.values, bands: result.bands });
    frames = Math.max(frames, result.frames);
  }
  if (frames < 4 || !differences.length) {
    return null;
  }

  // Sum every resolution and every band into one value per frame, applying the
  // band weight where one is given.
  const bandWeights = options.bandWeights;
  const activation = new Float32Array(frames);
  let bandColumn = 0;
  for (const { values, bands } of differences) {
    for (let frame = 0; frame < frames; frame += 1) {
      const row = frame * bands;
      let sum = 0;
      for (let band = 0; band < bands; band += 1) {
        const weight = bandWeights?.[bandColumn + band] ?? 1;
        sum += (values[row + band] ?? 0) * weight;
      }
      activation[frame] += sum;
    }
    bandColumn += bands;
  }

  // Scale to 0..1 by a high percentile rather than the peak: a single frame of
  // noise can exceed every beat, and dividing by it pushes the beats down into
  // the floor. Measured on a noisy click track, that took the visible peak count
  // from 132 to 1.
  const sorted = Float32Array.from(activation).sort();
  const scale = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  if (scale > 0) {
    for (let frame = 0; frame < frames; frame += 1) {
      activation[frame] = Math.min(1, activation[frame] / scale);
    }
  }
  return { values: activation, fps };
}
