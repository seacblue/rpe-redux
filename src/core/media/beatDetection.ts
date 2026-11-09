/* eslint-disable max-lines -- onset analysis, candidate scoring, and phase refitting share one detector. */
/**
 * Fixed-tempo and beat-phase detection for chart timing.
 *
 * The detector turns decoded PCM into a spectral-flux onset envelope, finds the
 * dominant pulse with a harmonic autocorrelation, resolves half/double-time
 * candidates from the accent pattern, and fits the final grid against raw
 * attacks across the track. A buffer with no clear pulse returns `null`, so the
 * dialog can say the beat was not found instead of presenting a made-up tempo.
 * It owns no browser or chart state: the editor hands it an `AudioBuffer`, and
 * the result is a plain value that a caller can preview, edit, or commit.
 */
import type { AudioBufferLike } from "./audioAnalysis.ts";

/** The decoded buffer fields the detector reads, including the optional rate. */
export interface BeatDetectionBuffer extends AudioBufferLike {
  sampleRate?: number;
}

/** A compact peak envelope for the dialog's waveform preview. */
export interface BeatDetectionWaveform {
  peaks: Float32Array;
  duration: number;
}

/** The timing proposal plus the preview data the dialog draws. */
export interface BeatDetectionResult {
  /** Measured BPM, rounded to three decimals with near-integers snapped. */
  bpm: number;
  /** Audio time of beat zero in milliseconds, at the same precision. */
  offsetMs: number;
  waveform: BeatDetectionWaveform;
  /** Decimated onset strength, normalized to 0..1. */
  onset: Float32Array;
  onsetRate: number;
  duration: number;
  /** Beat-zero-relative render times for the primary grid. */
  beatTimes: Float32Array;
}

/** Limits and display sizes for one detection run. */
export interface BeatDetectionOptions {
  minBpm?: number;
  maxBpm?: number;
  maxCandidates?: number;
  /** Envelope analysis rate; 22050 keeps transients while remaining cheap. */
  targetSampleRate?: number;
}

const DEFAULT_MIN_BPM = 50;
const DEFAULT_MAX_BPM = 220;
const DEFAULT_MAX_CANDIDATES = 4;
const DEFAULT_TARGET_RATE = 22050;
const WAVEFORM_POINTS = 1600;
const ONSET_POINTS = 2400;
/** Below these internal thresholds the detector reports "not found". */
const MIN_RELIABILITY = 0.42;
const MIN_PERIODICITY = 0.45;
const MIN_COVERAGE = 0.2;
/** Output precision for BPM and offset, and the near-integer snap threshold. */
const TIMING_DIGITS = 3;
const SNAP_THRESHOLD = 0.001;
/** Attack timing search radius around one predicted beat, in seconds. */
const ATTACK_WINDOW = 0.035;

interface OnsetEnvelope {
  /** Low + mid flux, used for tempo and beat presence. */
  pulse: Float32Array;
  /** Low-band flux, used for kick phase. */
  low: Float32Array;
  /** Pulse plus high-band flux, used for the dialog's transient display. */
  full: Float32Array;
  sampleRate: number;
  hop: number;
  frameSize: number;
  fps: number;
  frames: number;
  /** Seconds from a frame's start to its analysis centre. */
  centre: number;
}

interface InternalCandidate {
  bpm: number;
  /** Phase in envelope-frame time, before the frame-centre correction. */
  phase: number;
  score: number;
  coverage: number;
  weak: number;
  halfRatio: number;
  sourceScore: number;
  /** Peak autocorrelation relative to the envelope variance. */
  periodicity: number;
  /** Circular concentration of low-band peaks around the candidate grid. */
  phaseConcentration: number;
}

interface Peak {
  time: number;
  value: number;
}

/**
 * Mix an audio buffer to mono.
 *
 * A plain average can cancel out-of-phase stereo material; when that happens the
 * louder channel is used instead, so a phase-inverted edit still produces a
 * useful onset envelope.
 */
export function mixToMono(buffer: BeatDetectionBuffer): Float32Array {
  const length = Math.max(0, Math.trunc(buffer?.length) || 0);
  const channels = Math.max(1, Math.trunc(buffer?.numberOfChannels) || 1);
  const mono = new Float32Array(length);
  const energies = new Float64Array(channels);
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel);
    let energy = 0;
    for (let index = 0; index < length; index++) {
      const value = data[index] ?? 0;
      mono[index] += value;
      energy += value * value;
    }
    energies[channel] = energy;
  }
  let monoEnergy = 0;
  for (let index = 0; index < length; index++) {
    mono[index] /= channels;
    monoEnergy += mono[index] * mono[index];
  }
  let loudest = 0;
  for (let channel = 1; channel < channels; channel++) {
    if (energies[channel] > energies[loudest]) {
      loudest = channel;
    }
  }
  if (monoEnergy < energies[loudest] * 0.05 && energies[loudest] > 0) {
    const data = buffer.getChannelData(loudest);
    for (let index = 0; index < length; index++) {
      mono[index] = data[index] ?? 0;
    }
  }
  return mono;
}

/** Detect the fixed BPM, beat-zero offset, and octave alternatives in a buffer. */
export function detectBeatGrid(
  buffer: BeatDetectionBuffer,
  options: BeatDetectionOptions = {},
): BeatDetectionResult | null {
  const sampleRate = Number(buffer?.sampleRate);
  const samples = mixToMono(buffer);
  const duration = Number(buffer?.duration);
  return detectBeatGridFromSamples(
    samples,
    Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100,
    Number.isFinite(duration) && duration > 0 ? duration : undefined,
    options,
  );
}

/**
 * Detect the automatic timing answer.
 *
 * Automatic detection reports one fixed BPM, or `null` when the track has no
 * clear pulse; callers no longer choose between a fixed grid and a
 * variable-tempo map.
 */
export function detectAutoTiming(
  buffer: BeatDetectionBuffer,
  options: BeatDetectionOptions = {},
): BeatDetectionResult | null {
  return detectBeatGrid(buffer, options);
}

/** One resampled envelope shared by every fixed-tempo pass. */
interface AnalysisContext {
  samples: Float32Array;
  sampleRate: number;
  envelope: OnsetEnvelope;
  totalDuration: number;
  minBpm: number;
  maxBpm: number;
  maxCandidates: number;
}

/** Resolve and clamp the BPM range, candidate count, and analysis rate. */
function resolveTimingLimits(options: BeatDetectionOptions): {
  minBpm: number;
  maxBpm: number;
  maxCandidates: number;
  targetRate: number;
} {
  const minBpm = clampNumber(options.minBpm, DEFAULT_MIN_BPM, 20, 400);
  const maxBpm = clampNumber(options.maxBpm, DEFAULT_MAX_BPM, minBpm + 1, 400);
  const maxCandidates = Math.max(
    1,
    Math.min(8, Math.trunc(options.maxCandidates ?? DEFAULT_MAX_CANDIDATES)),
  );
  const targetRate = clampNumber(options.targetSampleRate, DEFAULT_TARGET_RATE, 8000, 48000);
  return { minBpm, maxBpm, maxCandidates, targetRate };
}

/** Validate input, resample once, and build the shared onset envelope. */
function buildAnalysis(
  samples: Float32Array,
  sampleRate: number,
  duration: number | undefined,
  options: BeatDetectionOptions,
): AnalysisContext | null {
  if (!samples?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return null;
  }
  const { minBpm, maxBpm, maxCandidates, targetRate } = resolveTimingLimits(options);
  const rate = Math.min(sampleRate, targetRate);
  const envelope = buildOnsetEnvelope(resample(samples, sampleRate, rate), rate);
  if (!envelope || envelope.frames < 16) {
    return null;
  }
  const requestedDuration = Number(duration);
  return {
    samples,
    sampleRate,
    envelope,
    totalDuration:
      requestedDuration > 0 && Number.isFinite(requestedDuration)
        ? requestedDuration
        : samples.length / sampleRate,
    minBpm,
    maxBpm,
    maxCandidates,
  };
}

/** Detect the automatic answer from a mixed mono signal, or `null` when no pulse is found. */
export function detectAutoTimingFromSamples(
  samples: Float32Array,
  sampleRate: number,
  duration?: number,
  options: BeatDetectionOptions = {},
): BeatDetectionResult | null {
  return detectBeatGridFromSamples(samples, sampleRate, duration, options);
}

/**
 * Detect fixed timing from an already mixed mono signal.
 *
 * Empty input, an invalid sample rate, audio too short to build an onset
 * envelope, and audio without one reliable pulse all return `null`.
 */
export function detectBeatGridFromSamples(
  samples: Float32Array,
  sampleRate: number,
  duration?: number,
  options: BeatDetectionOptions = {},
): BeatDetectionResult | null {
  if (!samples?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return null;
  }
  const context = buildAnalysis(samples, sampleRate, duration, options);
  return context ? fixedFromEnvelope(samples, context) : null;
}

/** Detect a fixed grid from the shared analysis envelope, or `null` when unclear. */
function fixedFromEnvelope(
  samples: Float32Array,
  context: AnalysisContext,
): BeatDetectionResult | null {
  const { envelope, totalDuration, minBpm, maxBpm, maxCandidates } = context;
  const lowPeaks = findPeaks(envelope.low, envelope, 0.8);
  const candidates = findCandidates(envelope, minBpm, maxBpm, maxCandidates, lowPeaks);
  if (!candidates.length) {
    return null;
  }
  const best = candidates[0];
  const bestScore = Math.max(best.score, 1e-6);
  // Reliability is an internal accept/reject gate, not a number the author sees.
  // Unpitched noise can form a weak autocorrelation peak, but its peak barely
  // rises above the envelope variance and explains too few strong onsets.
  if (
    candidateReliability(best, bestScore) < MIN_RELIABILITY ||
    best.periodicity < MIN_PERIODICITY ||
    best.coverage < MIN_COVERAGE
  ) {
    return null;
  }
  const refit = refitFromLowPeaks(best, lowPeaks);
  // A regression phase is periodic; anchor the grid to the first strong
  // low-band onset so the result lands on the song's first beat rather than a
  // phantom beat before the intro.
  const firstLow = lowPeaks.find((peak) => peak.value >= 0.2) ?? lowPeaks[0];
  let bpm = clampBpm(refit.bpm, minBpm, maxBpm);
  let offsetSeconds = firstLow ? firstLow.time : Math.max(0, refit.offsetSeconds);
  // Raw attacks across the whole track resolve the period far below one onset
  // frame; the first pass keeps the search near the candidate grid, and the
  // second pass fits every accepted beat with the refined prediction.
  const refined = firstLow
    ? refineTimingFromAttacks(
        context.samples,
        context.sampleRate,
        firstLow.time,
        bpm,
        context.totalDuration,
      )
    : null;
  if (refined) {
    bpm = clampBpm(refined.bpm, minBpm, maxBpm);
    offsetSeconds = refined.offsetSeconds;
  }
  const measuredBpm = roundMeasuredTiming(bpm);
  const measuredOffset = roundMeasuredTiming(Math.max(0, offsetSeconds) * 1000);
  if (!(measuredBpm > 0) || !Number.isFinite(measuredOffset)) {
    return null;
  }
  return {
    bpm: measuredBpm,
    offsetMs: measuredOffset,
    waveform: {
      peaks: waveformPeaks(samples, WAVEFORM_POINTS),
      duration: totalDuration,
    },
    onset: decimate(envelope.full, ONSET_POINTS),
    onsetRate: envelope.fps,
    duration: totalDuration,
    beatTimes: buildBeatTimes(measuredBpm, measuredOffset / 1000, totalDuration),
  };
}

/** Linear resampling into the detector's analysis rate. */
function resample(samples: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || sourceRate === targetRate) {
    return samples;
  }
  const length = Math.max(1, Math.round((samples.length * targetRate) / sourceRate));
  const result = new Float32Array(length);
  const step = sourceRate / targetRate;
  for (let index = 0; index < length; index++) {
    const position = index * step;
    const floor = Math.floor(position);
    const fraction = position - floor;
    const left = samples[floor] ?? 0;
    const right = samples[floor + 1] ?? left;
    result[index] = left + (right - left) * fraction;
  }
  return result;
}

/** Build the low, mid, high, and combined spectral-flux envelopes. */
function buildOnsetEnvelope(samples: Float32Array, sampleRate: number): OnsetEnvelope | null {
  const frameSize = sampleRate >= 16000 ? 1024 : 512;
  const hop = Math.max(64, frameSize >> 2);
  const half = frameSize >> 1;
  const frames = Math.floor((samples.length - frameSize) / hop) + 1;
  if (frames < 4) {
    return null;
  }
  const window = new Float64Array(frameSize);
  for (let index = 0; index < frameSize; index++) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (frameSize - 1));
  }
  const even = new Float64Array(frameSize);
  const odd = new Float64Array(frameSize);
  const previous = new Float64Array(half);
  const low = new Float32Array(frames);
  const mid = new Float32Array(frames);
  const high = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    const start = frame * hop;
    let energy = 0;
    for (let index = 0; index < frameSize; index++) {
      const value = (samples[start + index] ?? 0) * window[index];
      even[index] = value;
      odd[index] = 0;
      energy += value * value;
    }
    fft(even, odd);
    let lowFlux = 0;
    let midFlux = 0;
    let highFlux = 0;
    for (let bin = 1; bin < half; bin++) {
      const magnitude = Math.log1p((30 * Math.hypot(even[bin], odd[bin])) / frameSize);
      const difference = magnitude - previous[bin];
      previous[bin] = magnitude;
      if (difference <= 0) {
        continue;
      }
      const hz = (bin * sampleRate) / frameSize;
      if (hz < 160) {
        lowFlux += difference * 1.3;
      } else if (hz < 2200) {
        midFlux += difference;
      } else if (hz < 10000) {
        highFlux += difference * 0.75;
      }
    }
    const gate = Math.sqrt(energy / frameSize) > 1e-6 ? 1 : 0;
    low[frame] = lowFlux * gate;
    mid[frame] = midFlux * gate;
    high[frame] = highFlux * gate;
  }
  const radius = Math.max(1, Math.round((0.45 * sampleRate) / hop));
  const lowMean = movingAverage(low, radius);
  const midMean = movingAverage(mid, radius);
  const highMean = movingAverage(high, radius);
  const pulse = new Float32Array(frames);
  const lowPulse = new Float32Array(frames);
  const full = new Float32Array(frames);
  let pulsePeak = 0;
  let lowPeak = 0;
  let fullPeak = 0;
  for (let frame = 0; frame < frames; frame++) {
    const lowValue = Math.max(0, low[frame] - lowMean[frame] * 1.05);
    const midValue = Math.max(0, mid[frame] - midMean[frame] * 1.05);
    const highValue = Math.max(0, high[frame] - highMean[frame] * 1.05);
    pulse[frame] = lowValue * 1.15 + midValue;
    lowPulse[frame] = lowValue;
    full[frame] = pulse[frame] + highValue * 0.22;
    pulsePeak = Math.max(pulsePeak, pulse[frame]);
    lowPeak = Math.max(lowPeak, lowPulse[frame]);
    fullPeak = Math.max(fullPeak, full[frame]);
  }
  normalize(pulse, pulsePeak);
  normalize(lowPulse, lowPeak);
  normalize(full, fullPeak);
  return {
    pulse,
    low: lowPulse,
    full,
    sampleRate,
    hop,
    frameSize,
    fps: sampleRate / hop,
    frames,
    centre: frameSize / 2 / sampleRate,
  };
}

/** In-place radix-2 FFT; the detector only needs magnitude, not phase. */
function fft(even: Float64Array, odd: Float64Array): void {
  const length = even.length;
  for (let index = 1, reverse = 0; index < length; index++) {
    let bit = length >> 1;
    for (; reverse & bit; bit >>= 1) {
      reverse ^= bit;
    }
    reverse ^= bit;
    if (index < reverse) {
      [even[index], even[reverse]] = [even[reverse], even[index]];
      [odd[index], odd[reverse]] = [odd[reverse], odd[index]];
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
      for (let offset = 0; offset < half; offset++) {
        const target = start + offset;
        const paired = target + half;
        const real = even[paired] * cos - odd[paired] * sin;
        const imaginary = even[paired] * sin + odd[paired] * cos;
        even[paired] = even[target] - real;
        odd[paired] = odd[target] - imaginary;
        even[target] += real;
        odd[target] += imaginary;
        const nextCos = cos * cosine - sin * sine;
        sin = cos * sine + sin * cosine;
        cos = nextCos;
      }
    }
  }
}

/**
 * Blend period evidence, onset coverage, and phase concentration into 0..1.
 * `bestScore` normalises the pulse score against the strongest candidate.
 */
function candidateReliability(candidate: InternalCandidate, bestScore: number): number {
  return clamp01(
    0.05 +
      0.42 * candidate.coverage +
      0.2 * (candidate.score / Math.max(1e-6, bestScore)) +
      0.2 * candidate.periodicity +
      0.13 * candidate.phaseConcentration +
      0.05 * (1 - candidate.weak),
  );
}

/** Find tempo peaks, their octave relatives, and rank them with phase evidence. */
function findCandidates(
  envelope: OnsetEnvelope,
  minBpm: number,
  maxBpm: number,
  maxCandidates: number,
  lowPeaks: readonly Peak[],
): InternalCandidate[] {
  const minLag = Math.max(2, Math.floor((envelope.fps * 60) / maxBpm));
  const maxLag = Math.ceil((envelope.fps * 60) / minBpm) + 1;
  const autocorrelation = acf(envelope.pulse, maxLag + 1);
  const variance = Math.max(autocorrelation[0], 1e-9);
  const tempoScores: { bpm: number; score: number }[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = autocorrelation[lag] ?? 0;
    if (lag * 2 < autocorrelation.length) {
      score += 0.55 * autocorrelation[lag * 2];
    }
    if (lag * 3 < autocorrelation.length) {
      score += 0.3 * autocorrelation[lag * 3];
    }
    if (lag * 4 < autocorrelation.length) {
      score += 0.15 * autocorrelation[lag * 4];
    }
    tempoScores.push({ bpm: (60 * envelope.fps) / lag, score });
  }
  const peaks: { bpm: number; score: number }[] = [];
  for (let index = 1; index < tempoScores.length - 1; index++) {
    if (
      tempoScores[index].score > tempoScores[index - 1].score &&
      tempoScores[index].score >= tempoScores[index + 1].score &&
      tempoScores[index].score > 0
    ) {
      peaks.push(tempoScores[index]);
    }
  }
  peaks.sort((left, right) => right.score - left.score);
  const expanded: { bpm: number; sourceScore: number }[] = [];
  for (const peak of peaks.slice(0, 12)) {
    for (const multiplier of [0.5, 1, 2, 1.5, 2 / 3]) {
      const bpm = peak.bpm * multiplier;
      if (bpm >= minBpm && bpm <= maxBpm) {
        expanded.push({ bpm, sourceScore: peak.score });
      }
    }
  }
  expanded.sort((left, right) => right.sourceScore - left.sourceScore);
  const unique: { bpm: number; sourceScore: number }[] = [];
  for (const candidate of expanded) {
    if (!unique.some((entry) => Math.abs(entry.bpm - candidate.bpm) / candidate.bpm < 0.012)) {
      unique.push(candidate);
    }
  }
  const pulsePeaks = findPeaks(envelope.pulse, envelope, 1.1);
  const scored: InternalCandidate[] = [];
  for (const candidate of unique.slice(0, 16)) {
    const initialPhase = foldPhase(envelope, candidate.bpm);
    const refined = refineBpm(envelope, candidate.bpm, initialPhase);
    const phase = foldPhase(envelope, refined);
    const pulse = pulseScore(envelope.pulse, envelope.fps, refined, phase);
    const lowPulse = pulseScore(envelope.low, envelope.fps, refined, phase);
    const coverage = coverageOf(pulsePeaks, refined, phase + envelope.centre);
    const period = 60 / refined;
    const beatStrengths: number[] = [];
    const halfStrengths: number[] = [];
    for (let time = phase; time < envelope.frames / envelope.fps; time += period) {
      beatStrengths.push(sampleEnvelope(envelope.pulse, envelope.fps, time, 2));
      const halfway = time + period / 2;
      if (halfway < envelope.frames / envelope.fps) {
        halfStrengths.push(sampleEnvelope(envelope.pulse, envelope.fps, halfway, 2));
      }
    }
    const beatMean = mean(beatStrengths);
    const halfMean = mean(halfStrengths);
    const halfRatio = beatMean > 1e-6 ? halfMean / beatMean : 0;
    const weakThreshold = 0.35 * Math.max(1e-6, max(beatStrengths));
    const weak = beatStrengths.length
      ? beatStrengths.filter((value) => value < weakThreshold).length / beatStrengths.length
      : 1;
    const levelPenalty = 1 - 0.4 * Math.max(0, (weak - 0.25) / 0.5);
    const score =
      (coverage * 0.58 +
        Math.min(1, lowPulse.score * 1.3) * 0.25 +
        Math.min(1, Math.max(0, pulse.score - pulse.offbeat * 0.35) * 1.7) * 0.17) *
      levelPenalty;
    const periodicity = clamp01((candidate.sourceScore / variance) * 2.5);
    const phaseConcentration = concentrationOf(lowPeaks, refined, phase + envelope.centre);
    if (score > 0 && periodicity > 0.12) {
      scored.push({
        bpm: refined,
        phase,
        score,
        coverage,
        weak,
        halfRatio,
        sourceScore: candidate.sourceScore,
        periodicity,
        phaseConcentration,
      });
    }
  }
  // A strong pulse halfway between candidate beats marks a half-time reading;
  // keep its double so the metrical level can be compared on the same footing.
  for (const candidate of scored.slice(0, 14)) {
    if (candidate.halfRatio > 0.55 && candidate.bpm * 2 <= maxBpm) {
      scored.push({
        ...candidate,
        bpm: candidate.bpm * 2,
        score: candidate.score * (0.85 + 0.5 * Math.min(1, candidate.halfRatio)),
        sourceScore: candidate.sourceScore * 0.9,
      });
    }
  }
  scored.sort((left, right) => right.score - left.score);
  const top: InternalCandidate[] = [];
  for (const candidate of scored) {
    if (!top.some((entry) => Math.abs(entry.bpm - candidate.bpm) / candidate.bpm < 0.014)) {
      top.push(candidate);
    }
    if (top.length >= maxCandidates) {
      break;
    }
  }
  return top;
}

/** Direct autocorrelation of the onset envelope. */
function acf(values: Float32Array, size: number): Float64Array {
  const result = new Float64Array(size);
  const length = values.length;
  let average = 0;
  for (const value of values) {
    average += value;
  }
  average /= Math.max(1, length);
  for (let lag = 0; lag < size; lag++) {
    let sum = 0;
    for (let index = lag; index < length; index++) {
      sum += (values[index] - average) * (values[index - lag] - average);
    }
    result[lag] = sum / Math.max(1, length - lag);
  }
  return result;
}

/** Circular phase histogram: low-band onsets dominate, full pulse breaks ties. */
function foldPhase(envelope: OnsetEnvelope, bpm: number): number {
  const period = 60 / bpm;
  const bins = 256;
  const histogram = new Float64Array(bins);
  for (let frame = 0; frame < envelope.frames; frame++) {
    const time = frame / envelope.fps;
    const phase = ((time % period) + period) % period;
    const bin = Math.min(bins - 1, Math.floor((phase / period) * bins));
    histogram[bin] += envelope.low[frame] + 0.25 * envelope.pulse[frame];
  }
  const smoothed = circularSmooth(histogram);
  let best = 0;
  for (let bin = 1; bin < bins; bin++) {
    if (smoothed[bin] > smoothed[best]) {
      best = bin;
    }
  }
  const left = smoothed[(best - 1 + bins) % bins];
  const centre = smoothed[best];
  const right = smoothed[(best + 1) % bins];
  const denominator = left - 2 * centre + right;
  const delta = denominator === 0 ? 0 : (0.5 * (left - right)) / denominator;
  return (((best + 0.5 + Math.max(-1, Math.min(1, delta))) / bins) * period) % period;
}

/** Score one candidate grid against an envelope and its midway points. */
function pulseScore(
  values: Float32Array,
  fps: number,
  bpm: number,
  phase: number,
): { score: number; offbeat: number } {
  const period = 60 / bpm;
  const end = values.length / fps;
  let sum = 0;
  let offbeat = 0;
  let count = 0;
  for (let time = phase; time < end; time += period) {
    sum += sampleEnvelope(values, fps, time, 1.5);
    offbeat += sampleEnvelope(values, fps, time + period / 2, 1);
    count++;
  }
  return {
    score: count ? sum / count : 0,
    offbeat: count ? offbeat / count : 0,
  };
}

/** Search a small neighbourhood for the BPM that best explains the pulse. */
function refineBpm(envelope: OnsetEnvelope, bpm: number, phase: number): number {
  let best = bpm;
  let bestScore = -Infinity;
  for (let delta = -2; delta <= 2.0001; delta += 0.02) {
    const candidate = bpm + delta;
    const score = pulseScore(envelope.pulse, envelope.fps, candidate, phase);
    const total = score.score - 0.15 * score.offbeat;
    if (total > bestScore) {
      bestScore = total;
      best = candidate;
    }
  }
  return best;
}

/** Read the strongest envelope sample within a small window around a time. */
function sampleEnvelope(
  values: Float32Array,
  fps: number,
  time: number,
  radiusFrames: number,
): number {
  const centre = time * fps;
  const low = Math.max(0, Math.floor(centre - radiusFrames));
  const high = Math.min(values.length - 1, Math.ceil(centre + radiusFrames));
  let maximum = 0;
  for (let index = low; index <= high; index++) {
    maximum = Math.max(maximum, values[index] ?? 0);
  }
  return maximum;
}

/** Weighted circular concentration of low-band peaks for one grid period. */
function concentrationOf(peaks: readonly Peak[], bpm: number, phaseSeconds: number): number {
  const period = 60 / bpm;
  let cosine = 0;
  let sine = 0;
  let weight = 0;
  for (const peak of peaks) {
    const phase = (((peak.time - phaseSeconds) % period) + period) % period;
    const angle = (2 * Math.PI * phase) / period;
    cosine += peak.value * Math.cos(angle);
    sine += peak.value * Math.sin(angle);
    weight += peak.value;
  }
  return weight > 0 ? Math.min(1, Math.hypot(cosine, sine) / weight) : 0;
}

/** Share of pulse peaks that fall on a candidate grid. */
function coverageOf(peaks: readonly Peak[], bpm: number, phaseSeconds: number): number {
  const period = 60 / bpm;
  let covered = 0;
  let total = 0;
  for (const peak of peaks) {
    total += peak.value;
    const distance =
      ((((peak.time - phaseSeconds + period / 2) % period) + period) % period) - period / 2;
    if (Math.abs(distance) <= 0.035) {
      covered += peak.value;
    }
  }
  return total > 0 ? covered / total : 0;
}

/** Pick local maxima with parabolic sub-frame timing. */
function findPeaks(values: Float32Array, envelope: OnsetEnvelope, thresholdFactor: number): Peak[] {
  let average = 0;
  for (const value of values) {
    average += value;
  }
  average /= Math.max(1, values.length);
  let variance = 0;
  for (const value of values) {
    variance += (value - average) * (value - average);
  }
  const deviation = Math.sqrt(variance / Math.max(1, values.length));
  const threshold = average + deviation * thresholdFactor;
  const raw: Peak[] = [];
  for (let index = 2; index < values.length - 2; index++) {
    const value = values[index];
    if (
      value < threshold ||
      value < values[index - 1] ||
      value <= values[index + 1] ||
      value < values[index - 2] ||
      value <= values[index + 2]
    ) {
      continue;
    }
    const left = values[index - 1];
    const right = values[index + 1];
    const denominator = left - 2 * value + right;
    const delta = denominator === 0 ? 0 : (0.5 * (left - right)) / denominator;
    raw.push({
      time: (index + Math.max(-0.5, Math.min(0.5, delta))) / envelope.fps + envelope.centre,
      value,
    });
  }
  raw.sort((left, right) => left.time - right.time);
  const kept: Peak[] = [];
  for (const peak of raw) {
    const previous = kept.at(-1);
    if (!previous || peak.time - previous.time >= 0.05) {
      kept.push(peak);
    } else if (peak.value > previous.value) {
      kept[kept.length - 1] = peak;
    }
  }
  return kept;
}

/** One accepted raw attack: its beat index and measured audio time. */
interface AttackPoint {
  beat: number;
  time: number;
}

/** A fitted beat line plus the spread of the attacks that produced it. */
interface BeatLineFit {
  offsetSeconds: number;
  bpm: number;
  deviation: number;
  points: number;
}

/**
 * Refine the grid from raw attacks across the track.
 *
 * The onset envelope is quantised to its analysis hop. The raw first difference
 * marks each transient directly, so a robust line through those attack times
 * resolves both the period and beat zero well below that hop. The first pass
 * predicts a short opening window; the second pass extends the fitted grid over
 * the whole track so a small initial tempo error cannot push later beats out of
 * the attack search window. Returns `null` when too few attacks agree.
 */
function refineTimingFromAttacks(
  samples: Float32Array,
  sampleRate: number,
  offsetSeconds: number,
  bpm: number,
  duration: number,
): { bpm: number; offsetSeconds: number } | null {
  if (!(bpm > 0) || !(sampleRate > 0) || !(duration > 0)) {
    return null;
  }
  const opening = fitAttackGrid(samples, sampleRate, offsetSeconds, bpm, duration, 24);
  if (!opening || opening.points < 8) {
    return null;
  }
  const fitted =
    fitAttackGrid(samples, sampleRate, opening.offsetSeconds, opening.bpm, duration, 0) ?? opening;
  if (Math.abs(fitted.bpm - bpm) / bpm > 0.02 || fitted.deviation > 0.006) {
    return null;
  }
  return {
    bpm: fitted.bpm,
    offsetSeconds: Math.max(0, fitted.offsetSeconds),
  };
}

/** Collect attacks around a predicted grid and robustly fit one line through them. */
function fitAttackGrid(
  samples: Float32Array,
  sampleRate: number,
  offsetSeconds: number,
  bpm: number,
  duration: number,
  maxBeats: number,
): BeatLineFit | null {
  const period = 60 / bpm;
  const available = Math.floor((duration - offsetSeconds) / period) + 1;
  const limit = maxBeats > 0 ? Math.min(maxBeats, available) : available;
  const count = Math.max(0, Math.min(4096, limit));
  const points: AttackPoint[] = [];
  for (let beat = 0; beat < count; beat++) {
    const expected = offsetSeconds + beat * period;
    const delta = attackDelta(samples, sampleRate, expected);
    if (delta !== null) {
      points.push({ beat, time: expected + delta });
    }
  }
  if (points.length < 8) {
    return null;
  }
  const fit = robustBeatLine(points);
  return fit ? { ...fit, points: points.length } : null;
}

/**
 * Fit one beat line while dropping attacks that do not agree with the majority.
 *
 * The median absolute residual keeps a few mis-detected transients (a cymbal
 * before the kick, a missed beat) from tilting the period.
 */
function robustBeatLine(
  points: readonly AttackPoint[],
): { offsetSeconds: number; bpm: number; deviation: number } | null {
  let active = points.slice();
  let fit = leastSquaresBeatLine(active);
  for (let iteration = 0; iteration < 3; iteration++) {
    if (!fit) {
      break;
    }
    const current = fit;
    const residuals = active.map(
      (point) => point.time - (current.offsetSeconds + current.slope * point.beat),
    );
    const centre = median(residuals);
    const deviation = median(residuals.map((residual) => Math.abs(residual - centre)));
    const tolerance = Math.max(0.0015, Math.min(0.006, deviation * 4));
    const next = active.filter((_, index) => Math.abs(residuals[index] - centre) <= tolerance);
    if (next.length === active.length || next.length < 8) {
      break;
    }
    active = next;
    fit = leastSquaresBeatLine(active);
  }
  if (!fit || !(fit.slope > 0)) {
    return null;
  }
  const residuals = active.map(
    (point) => point.time - (fit.offsetSeconds + fit.slope * point.beat),
  );
  const centre = median(residuals);
  const deviation = median(residuals.map((residual) => Math.abs(residual - centre)));
  return {
    offsetSeconds: fit.offsetSeconds,
    bpm: 60 / fit.slope,
    deviation,
  };
}

/** Ordinary least squares for time over beat index. */
function leastSquaresBeatLine(
  points: readonly AttackPoint[],
): { offsetSeconds: number; slope: number } | null {
  if (points.length < 2) {
    return null;
  }
  let sumBeat = 0;
  let sumTime = 0;
  let sumBeatSquared = 0;
  let sumBeatTime = 0;
  for (const point of points) {
    sumBeat += point.beat;
    sumTime += point.time;
    sumBeatSquared += point.beat * point.beat;
    sumBeatTime += point.beat * point.time;
  }
  const denominator = points.length * sumBeatSquared - sumBeat * sumBeat;
  if (!(denominator > 0)) {
    return null;
  }
  const slope = (points.length * sumBeatTime - sumBeat * sumTime) / denominator;
  if (!(slope > 0)) {
    return null;
  }
  return { offsetSeconds: (sumTime - slope * sumBeat) / points.length, slope };
}

/**
 * Time shift from the strongest attack near one expected beat.
 *
 * The spectral-flux peak reacts to the FFT window and can sit a few
 * milliseconds away from the click. A short trailing energy window marks the
 * raw attack directly: find the energy maximum, walk back to where the attack
 * crosses 20% of the peak, and interpolate that crossing between samples. The
 * window smooths sample noise so repeated hits report the same attack time.
 * Returns `null` when no clear transient exists or it falls outside the search
 * window.
 */
function attackDelta(samples: Float32Array, sampleRate: number, time: number): number | null {
  const from = Math.max(1, Math.floor((time - ATTACK_WINDOW) * sampleRate));
  const to = Math.min(samples.length - 1, Math.ceil((time + ATTACK_WINDOW) * sampleRate));
  if (to - from < 8) {
    return null;
  }
  const window = Math.max(2, Math.round(sampleRate * 0.0015));
  const prefixStart = Math.max(0, from - window);
  const prefix = new Float64Array(to - prefixStart + 2);
  for (let index = prefixStart; index <= to; index++) {
    const sample = samples[index] ?? 0;
    prefix[index - prefixStart + 1] = prefix[index - prefixStart] + sample * sample;
  }
  const energyAt = (index: number): number => {
    const start = Math.max(0, index - window + 1);
    const count = index - start + 1;
    return (prefix[index - prefixStart + 1] - prefix[start - prefixStart]) / Math.max(1, count);
  };
  let peak = 0;
  let peakIndex = from;
  for (let index = from; index <= to; index++) {
    const value = energyAt(index);
    if (value > peak) {
      peak = value;
      peakIndex = index;
    }
  }
  if (!(peak > 1e-10)) {
    return null;
  }
  const threshold = peak * 0.2;
  let lead = from;
  for (let index = peakIndex; index >= from; index--) {
    if (energyAt(index) < threshold) {
      lead = Math.min(peakIndex, index + 1);
      break;
    }
  }
  const left = energyAt(lead - 1);
  const right = energyAt(lead);
  let crossing = lead;
  if (right > left) {
    const fraction = (threshold - left) / (right - left);
    crossing = lead - 1 + Math.max(0, Math.min(1, fraction));
  }
  // The trailing window reports the point where it has collected enough of the
  // rise; its centre is the closest raw estimate of the attack start.
  const delta = (crossing - window / 2) / sampleRate - time;
  return delta >= -ATTACK_WINDOW && delta <= ATTACK_WINDOW ? delta : null;
}

/**
 * Refit the period and phase from low-band peaks near the candidate grid.
 *
 * This removes frame quantisation and handles a kick that only marks every
 * second or fourth beat: the regression slope is still one beat even when the
 * assigned indices jump.
 */
function refitFromLowPeaks(
  candidate: InternalCandidate,
  lowPeaks: readonly Peak[],
): { bpm: number; offsetSeconds: number } {
  let period = 60 / candidate.bpm;
  let phase = candidate.phase;
  for (let iteration = 0; iteration < 4; iteration++) {
    const tolerance = Math.min(period * (iteration === 0 ? 0.18 : 0.12), 0.08);
    const points: { index: number; time: number; weight: number }[] = [];
    for (const peak of lowPeaks) {
      const index = Math.round((peak.time - phase) / period);
      if (index < 0) {
        continue;
      }
      const expected = phase + index * period;
      if (Math.abs(peak.time - expected) <= tolerance) {
        points.push({ index, time: peak.time, weight: peak.value });
      }
    }
    if (points.length < 8) {
      break;
    }
    let weight = 0;
    let weightIndex = 0;
    let weightTime = 0;
    let weightIndexSquared = 0;
    let weightIndexTime = 0;
    for (const point of points) {
      weight += point.weight;
      weightIndex += point.weight * point.index;
      weightTime += point.weight * point.time;
      weightIndexSquared += point.weight * point.index * point.index;
      weightIndexTime += point.weight * point.index * point.time;
    }
    const denominator = weight * weightIndexSquared - weightIndex * weightIndex;
    if (Math.abs(denominator) < 1e-9) {
      break;
    }
    const nextPeriod = (weight * weightIndexTime - weightIndex * weightTime) / denominator;
    if (!(nextPeriod > 0.15 && nextPeriod < 1.5)) {
      break;
    }
    period = nextPeriod;
    phase = (weightTime - period * weightIndex) / weight;
  }
  return {
    bpm: 60 / period,
    offsetSeconds: Math.max(0, phase),
  };
}

/** Build the primary grid's beat times from beat zero through the song. */
function buildBeatTimes(bpm: number, offsetSeconds: number, duration: number): Float32Array {
  if (!(bpm > 0) || !(duration > 0)) {
    return new Float32Array(0);
  }
  const period = 60 / bpm;
  const start = offsetSeconds >= 0 ? offsetSeconds : 0;
  const count = Math.min(8192, Math.max(0, Math.floor((duration - start) / period) + 1));
  const times = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    times[index] = start + index * period;
  }
  return times;
}

/** Downsample a mono signal to max-amplitude buckets for a waveform preview. */
function waveformPeaks(samples: Float32Array, points: number): Float32Array {
  const result = new Float32Array(points);
  if (!samples.length) {
    return result;
  }
  let peak = 0;
  for (let point = 0; point < points; point++) {
    const start = Math.floor((point * samples.length) / points);
    const end = Math.max(start + 1, Math.floor(((point + 1) * samples.length) / points));
    let maximum = 0;
    for (let index = start; index < end && index < samples.length; index++) {
      maximum = Math.max(maximum, Math.abs(samples[index]));
    }
    result[point] = maximum;
    peak = Math.max(peak, maximum);
  }
  if (peak > 0) {
    for (let point = 0; point < points; point++) {
      result[point] /= peak;
    }
  }
  return result;
}

/** Max-pool an onset envelope into a small display array. */
function decimate(values: Float32Array, points: number): Float32Array {
  const result = new Float32Array(points);
  if (!values.length) {
    return result;
  }
  for (let point = 0; point < points; point++) {
    const start = Math.floor((point * values.length) / points);
    const end = Math.max(start + 1, Math.floor(((point + 1) * values.length) / points));
    let maximum = 0;
    for (let index = start; index < end && index < values.length; index++) {
      maximum = Math.max(maximum, values[index]);
    }
    result[point] = maximum;
  }
  return result;
}

/** Moving average with a centred window, in O(n) using a prefix sum. */
function movingAverage(values: Float32Array, radius: number): Float32Array {
  const result = new Float32Array(values.length);
  const prefix = new Float64Array(values.length + 1);
  for (let index = 0; index < values.length; index++) {
    prefix[index + 1] = prefix[index] + values[index];
  }
  for (let index = 0; index < values.length; index++) {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length, index + radius + 1);
    result[index] = (prefix[end] - prefix[start]) / (end - start);
  }
  return result;
}

/** Three-tap circular smoothing for the phase histogram. */
function circularSmooth(values: Float64Array): Float64Array {
  const result = new Float64Array(values.length);
  for (let index = 0; index < values.length; index++) {
    result[index] =
      0.25 * values[(index - 1 + values.length) % values.length] +
      0.5 * values[index] +
      0.25 * values[(index + 1) % values.length];
  }
  return result;
}

/** Divide an array by its peak when the peak is positive. */
function normalize(values: Float32Array, peak: number): void {
  if (!(peak > 0)) {
    return;
  }
  const scale = 1 / peak;
  for (let index = 0; index < values.length; index++) {
    values[index] *= scale;
  }
}

/** Arithmetic mean of a list, or zero for an empty list. */
function mean(values: readonly number[]): number {
  if (!values.length) {
    return 0;
  }
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}

/** Median of a list, or zero for an empty list. */
function median(values: readonly number[]): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Maximum of a list, or zero for an empty list. */
function max(values: readonly number[]): number {
  let maximum = 0;
  for (const value of values) {
    maximum = Math.max(maximum, value);
  }
  return maximum;
}

/** Clamp a value into [minimum, maximum], using a fallback for non-finite input. */
function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

/** Clamp a detected BPM into the configured range. */
function clampBpm(value: number, minBpm: number, maxBpm: number): number {
  const bpm = Number.isFinite(value) && value > 0 ? value : minBpm;
  return Math.max(minBpm, Math.min(maxBpm, bpm));
}

/** Clamp a value into [0, 1]. */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Round a measured BPM or offset to three decimals.
 *
 * A value within the snap threshold of a whole number becomes that integer, so
 * an exact 128.0004 BPM reads as 128 rather than as a spurious decimal.
 */
export function roundMeasuredTiming(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const whole = Math.round(value);
  if (Math.abs(value - whole) < SNAP_THRESHOLD) {
    return whole;
  }
  return Math.round(value * 10 ** TIMING_DIGITS) / 10 ** TIMING_DIGITS;
}
