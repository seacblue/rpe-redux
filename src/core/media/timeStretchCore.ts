/**
 * Streaming time-domain time-stretcher for decoded music.
 *
 * The stretcher is a WSOLA implementation: it repeats or skips short waveform
 * segments and crossfades the joins, so tempo changes without changing pitch.
 * The DSP lives here so it can run on the audio thread or be exercised by the
 * unit suite; `timeStretchProcessor.ts` owns the worklet lifecycle.
 *
 * Slow rates use longer sequences and overlaps than realtime. A short grain
 * repeats too often and a short join leaves an audible seam, while a 40-60 ms
 * sequence with a ~20-25% raised-cosine join keeps the repeated material below
 * the range where it sounds like a separate event. The source buffer is fully
 * decoded, so the longer analysis window adds CPU work but no playback latency.
 */
import { clamp } from "../utils/numbers.ts";

const MIN_OVERLAP = 16;
const READY_BATCHES = 4;
const MIN_RATE = 0.001;
const MAX_RATE = 16;
const CENTER_BIAS = 0.04;
const LONG_CORRELATION_WEIGHT = 0.6;
const TAIL_FADE_MS = 4;
const MAX_SUPPRESSIONS = 4;
const TRANSIENT_FRAME_MS = 1.5;
const TRANSIENT_MIN_GAP_MS = 30;
const TRANSIENT_BASELINE_MS = 15;
const TRANSIENT_BODY_MS = 55;

/** Segment lengths for one tempo; slower rates use the larger windows. */
interface StretchTuning {
  sequenceMs: number;
  overlapMs: number;
  seekMs: number;
  referenceMs: number;
}

/** Inputs for one stretcher: decoded channels and the initial tempo. */
export interface TimeStretchOptions {
  channels: Float32Array[];
  sampleRate: number;
  rate: number;
  positionSeconds: number;
  /**
   * Input frames of strong onsets in ascending order, as returned by
   * `detectTransients`. Grains place these attacks on the output clock and
   * replace displaced copies with surrounding audio.
   */
  transients?: ArrayLike<number>;
}

/**
 * Find strong onsets in decoded audio.
 *
 * The detector compares short-time energy in adjacent frames. It runs while a
 * document loads, outside the audio thread, and returns sample indices in
 * ascending order. Quiet tracks and steady material return an empty array.
 */
export function detectTransients(channels: Float32Array[], sampleRate: number): Int32Array {
  if (channels.length === 0) {
    return new Int32Array(0);
  }
  const length = Math.max(...channels.map((channel) => channel.length));
  const frame = Math.max(16, Math.round((sampleRate * TRANSIENT_FRAME_MS) / 1000));
  const hop = Math.max(8, Math.floor(frame / 2));
  if (length < frame * 2) {
    return new Int32Array(0);
  }
  const frames = Math.floor((length - frame) / hop) + 1;
  const energy = new Float64Array(frames);
  const flux = new Float32Array(frames);
  let previous = 0;
  for (let index = 0; index < frames; index += 1) {
    const start = index * hop;
    let sum = 0;
    for (const channel of channels) {
      const end = Math.min(channel.length, start + frame);
      for (let cursor = start; cursor < end; cursor += 1) {
        sum += channel[cursor] * channel[cursor];
      }
    }
    const value = sum / (frame * channels.length);
    energy[index] = value;
    flux[index] = Math.max(0, Math.log((value + 1e-9) / (previous + 1e-9)));
    previous = value;
  }
  const sorted = Float32Array.from(flux).sort();
  const median = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const percentile = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const threshold = Math.max(0.6, median + (percentile - median) * 3, percentile * 0.5);
  let maximumEnergy = 0;
  for (const value of energy) {
    maximumEnergy = Math.max(maximumEnergy, value);
  }
  const energyFloor = maximumEnergy * 0.004;
  const minimumGap = Math.max(1, Math.round((sampleRate * TRANSIENT_MIN_GAP_MS) / 1000));
  const baselineFrames = Math.max(
    2,
    Math.round((sampleRate * TRANSIENT_BASELINE_MS) / (1000 * hop)),
  );
  const positions: number[] = [];
  for (let index = 1; index < frames - 1; index += 1) {
    if (flux[index] < threshold || energy[index] < energyFloor) {
      continue;
    }
    if (flux[index] < flux[index - 1] || flux[index] < flux[index + 1]) {
      continue;
    }
    // Compare with the recent envelope so each cycle of a decaying bass
    // waveform cannot register as another attack after its zero crossing.
    let recentPeak = 0;
    for (let previous = Math.max(0, index - baselineFrames); previous < index - 1; previous += 1) {
      recentPeak = Math.max(recentPeak, energy[previous]);
    }
    if (energy[index] <= recentPeak * 1.2) {
      continue;
    }
    const sample = index * hop + frame;
    const previousSample = positions[positions.length - 1] ?? -minimumGap;
    if (sample - previousSample < minimumGap) {
      continue;
    }
    positions.push(sample);
  }
  return Int32Array.from(positions);
}

/** Longer grains and joins as the tempo falls, keeping the same pitch. */
function tuningForRate(rate: number): StretchTuning {
  if (rate <= 0.35) {
    return { sequenceMs: 50, overlapMs: 12, seekMs: 24, referenceMs: 18 };
  }
  if (rate <= 0.65) {
    return { sequenceMs: 46, overlapMs: 10, seekMs: 21, referenceMs: 16 };
  }
  if (rate <= 0.9) {
    return { sequenceMs: 42, overlapMs: 10, seekMs: 18, referenceMs: 14 };
  }
  return { sequenceMs: 30, overlapMs: 6, seekMs: 15, referenceMs: 10 };
}

/**
 * One decoded track prepared for direct playback or WSOLA.
 *
 * `prime()` generates the first output batch. `render()` then feeds arbitrary
 * render quanta from a small ready ring while the correlation search and
 * overlap work stay ahead of the audio clock.
 */
export class TimeStretch {
  private readonly channels: Float32Array[];
  private readonly channelCount: number;
  private readonly rate: number;
  private readonly length: number;
  private readonly startFrame: number;
  private readonly sequenceLength: number;
  private readonly overlapLength: number;
  private readonly seekLength: number;
  private readonly referenceLength: number;
  private readonly bodyLength: number;
  private readonly batchLength: number;
  private readonly nominalSkip: number;
  private readonly midBuffers: Float32Array[];
  private readonly fadeIn: Float32Array;
  private readonly fadeOut: Float32Array;
  private readonly correlationWindow: Float32Array;
  private readonly transients: ArrayLike<number>;
  private readonly transientReplacementOffsets: Int32Array;
  private readonly suppressionPositions = new Float64Array(MAX_SUPPRESSIONS);
  private readonly suppressionOffsets = new Int32Array(MAX_SUPPRESSIONS);
  private readonly suppressionLength: number;
  private readonly suppressionPre: number;
  private readonly transientBodyFrames: number;
  private readonly ready: Float32Array[];
  private readonly readyCapacity: number;
  private readonly targetFrames: number;
  private readonly tailFadeFrames: number;

  private inputPosition: number;
  private lastSearchCorrelation = 0;
  private probeLong = 0;
  private probeOverlap = 0;
  private suppressionCount = 0;
  private generatedFrames = 0;
  private skipFraction = 0;
  private firstBatch = true;
  private finished = false;
  private emittedFrames = 0;
  private readyRead = 0;
  private readyWrite = 0;
  private readyCount = 0;

  /** Derive segment lengths and buffers from the channels, rate, and start position. */
  constructor({ channels, sampleRate, rate, positionSeconds, transients }: TimeStretchOptions) {
    if (channels.length === 0) {
      throw new Error("TimeStretch needs at least one channel");
    }
    this.channels = channels;
    this.channelCount = channels.length;
    this.rate = clamp(Number(rate) || 1, MIN_RATE, MAX_RATE);
    this.length = Math.max(...channels.map((channel) => channel.length));
    this.startFrame = Math.max(0, Math.round((Number(positionSeconds) || 0) * sampleRate));

    const tuning = tuningForRate(this.rate);
    this.sequenceLength = Math.max(
      2 * MIN_OVERLAP + 1,
      Math.round((sampleRate * tuning.sequenceMs) / 1000),
    );
    const overlap = Math.max(MIN_OVERLAP, Math.round((sampleRate * tuning.overlapMs) / 1000));
    this.overlapLength = overlap - (overlap % 8);
    this.bodyLength = Math.max(1, this.sequenceLength - 2 * this.overlapLength);
    this.batchLength = this.overlapLength + this.bodyLength;
    this.nominalSkip = this.rate * this.batchLength;
    this.seekLength = Math.max(1, Math.round((sampleRate * tuning.seekMs) / 1000));
    this.referenceLength = Math.max(
      this.overlapLength + 8,
      Math.round((sampleRate * tuning.referenceMs) / 1000),
    );
    this.targetFrames = Math.max(0, Math.ceil((this.length - this.startFrame) / this.rate));
    this.tailFadeFrames =
      this.rate === 1
        ? 0
        : Math.min(this.targetFrames, Math.max(1, Math.round((sampleRate * TAIL_FADE_MS) / 1000)));
    this.transients = this.rate === 1 ? [] : (transients ?? []);
    this.transientReplacementOffsets = new Int32Array(this.transients.length);
    this.suppressionLength = Math.max(2, Math.floor(this.batchLength * 0.45));
    this.suppressionPre = Math.max(1, Math.floor(this.suppressionLength / 2));
    this.transientBodyFrames =
      this.rate < 1 ? Math.round((sampleRate * TRANSIENT_BODY_MS) / 1000) : 0;

    this.inputPosition = this.startFrame;
    this.midBuffers = channels.map(() => new Float32Array(this.referenceLength));
    this.fadeIn = new Float32Array(this.overlapLength);
    this.fadeOut = new Float32Array(this.overlapLength);
    const fadeDenominator = Math.max(1, this.overlapLength - 1);
    for (let sample = 0; sample < this.overlapLength; sample += 1) {
      const weight = 0.5 - 0.5 * Math.cos((Math.PI * sample) / fadeDenominator);
      this.fadeIn[sample] = weight;
      this.fadeOut[sample] = 1 - weight;
    }
    this.correlationWindow = new Float32Array(this.referenceLength);
    const correlationDenominator = Math.max(1, this.referenceLength - 1);
    for (let sample = 0; sample < this.referenceLength; sample += 1) {
      this.correlationWindow[sample] =
        0.5 - 0.5 * Math.cos((Math.PI * 2 * sample) / correlationDenominator);
    }
    this.ready = channels.map(() => new Float32Array(this.batchLength * READY_BATCHES));
    this.readyCapacity = this.batchLength * READY_BATCHES;
  }

  /** Number of output frames one generated batch contributes. */
  get batchFrames(): number {
    return this.batchLength;
  }

  /** Number of frames in the crossfade join. */
  get overlapFrames(): number {
    return this.overlapLength;
  }

  /** Generate the first output batch so playback can start without a CPU spike. */
  prime(): void {
    if (this.rate !== 1 && this.readyCount === 0 && !this.finished) {
      this.processBatch();
    }
  }

  /** Write `frames` samples into `output`, starting at `offset`. */
  render(output: Float32Array[], frames: number, offset = 0): number {
    const remaining = Math.max(0, this.targetFrames - this.emittedFrames);
    const limit = Math.min(frames, remaining);
    if (this.rate === 1) {
      return this.renderUnity(output, limit, offset);
    }
    const fadeStart = this.targetFrames - this.tailFadeFrames;
    let written = 0;
    while (written < limit) {
      if (this.readyCount === 0) {
        if (this.finished) {
          break;
        }
        this.processBatch();
      }
      const available = Math.min(limit - written, this.readyCount);
      const contiguous = Math.min(available, this.readyCapacity - this.readyRead);
      for (let channel = 0; channel < this.channelCount; channel += 1) {
        const source = this.ready[channel];
        const target = output[channel] ?? output[0];
        const start = offset + written;
        const room = Math.max(0, Math.min(contiguous, target.length - start));
        for (let index = 0; index < room; index += 1) {
          target[start + index] = source[this.readyRead + index];
        }
      }
      this.readyRead = (this.readyRead + contiguous) % this.readyCapacity;
      this.readyCount -= contiguous;
      written += contiguous;
    }
    const fadeFrom = Math.max(0, fadeStart - this.emittedFrames);
    if (this.tailFadeFrames > 0 && fadeFrom < written) {
      for (let index = fadeFrom; index < written; index += 1) {
        const gain = (this.targetFrames - (this.emittedFrames + index)) / this.tailFadeFrames;
        for (let channel = 0; channel < this.channelCount; channel += 1) {
          const target = output[channel] ?? output[0];
          const at = offset + index;
          if (at < target.length) {
            target[at] *= gain;
          }
        }
      }
    }
    this.emittedFrames += written;
    if (this.emittedFrames >= this.targetFrames) {
      this.finished = true;
    }
    return written;
  }

  /** Copy decoded PCM at unity rate, bypassing grain joins and onset processing. */
  private renderUnity(output: Float32Array[], frames: number, offset: number): number {
    const start = this.startFrame + this.emittedFrames;
    for (let channel = 0; channel < this.channelCount; channel += 1) {
      const source = this.channels[channel];
      const target = output[channel] ?? output[0];
      const end = Math.min(frames, target.length - offset);
      for (let index = 0; index < end; index += 1) {
        target[offset + index] = this.read(source, start + index);
      }
    }
    this.emittedFrames += frames;
    return frames;
  }

  /** Produce one output batch and advance the input by the nominal skip. */
  private processBatch(): void {
    if (this.finished) {
      return;
    }
    const batchStart = this.generatedFrames;
    let base = this.inputPosition;
    let correlation = 1;
    if (!this.firstBatch) {
      // Leave enough source frames for the remaining output at the tail.
      const remaining = Math.min(
        this.batchLength + this.referenceLength,
        this.targetFrames - batchStart,
      );
      const lastBase = Math.max(this.startFrame, this.length - remaining);
      const aligned = this.alignedBase(batchStart);
      if (aligned === null) {
        const position = Math.min(base, lastBase);
        base = position + this.seekBestOffset(position, lastBase);
        correlation = this.lastSearchCorrelation;
      } else {
        base = aligned;
        this.probe(base);
        correlation = this.probeOverlap;
      }
    }
    const overlap = this.overlapLength;
    const body = this.bodyLength;
    const ready = this.ready;
    const capacity = this.readyCapacity;
    const write = this.readyWrite;
    this.prepareSuppressions(base, batchStart);

    for (let channel = 0; channel < this.channelCount; channel += 1) {
      const source = this.channels[channel];
      const mid = this.midBuffers[channel];
      const target = ready[channel];
      let index = write;
      if (this.firstBatch) {
        // The first batch has no saved tail to fade from. Copying it directly
        // preserves a transient on the first beat instead of attenuating it
        // over the overlap window.
        for (let sample = 0; sample < overlap; sample += 1) {
          target[index % capacity] = this.renderSample(source, base + sample, batchStart + sample);
          index += 1;
        }
      } else {
        const rho = clamp(correlation, 0, 1);
        for (let sample = 0; sample < overlap; sample += 1) {
          const fadeIn = this.fadeIn[sample];
          const fadeOut = this.fadeOut[sample];
          // Raised-cosine windows with a power normalization: correlated
          // joins stay at unity gain, uncorrelated joins avoid the mid-fade
          // level dip of a plain linear crossfade. Negative correlations use
          // the same bounded gain as uncorrelated joins.
          const power = fadeIn * fadeIn + fadeOut * fadeOut + 2 * rho * fadeIn * fadeOut;
          const gain = 1 / Math.sqrt(power);
          const mixed =
            (this.renderSample(source, base + sample, batchStart + sample) * fadeIn +
              mid[sample] * fadeOut) *
            gain;
          target[index % capacity] = clamp(mixed, -1, 1);
          index += 1;
        }
      }
      for (let sample = 0; sample < body; sample += 1) {
        target[index % capacity] = this.renderSample(
          source,
          base + overlap + sample,
          batchStart + overlap + sample,
        );
        index += 1;
      }
      for (let sample = 0; sample < this.referenceLength; sample += 1) {
        mid[sample] = this.renderSample(
          source,
          base + overlap + body + sample,
          batchStart + overlap + body + sample,
        );
      }
    }

    this.readyWrite = (write + this.batchLength) % capacity;
    this.readyCount += this.batchLength;
    this.generatedFrames += this.batchLength;

    this.skipFraction += this.nominalSkip;
    const skip = Math.floor(this.skipFraction + 1e-9);
    this.skipFraction -= skip;
    this.inputPosition += skip;
    this.firstBatch = false;

    if (this.inputPosition >= this.length + this.sequenceLength) {
      this.finished = true;
    }
  }

  /**
   * Pick the input segment whose head best matches the previous output tail.
   *
   * The scan is symmetric around the nominal position. A forward-only scan
   * systematically chooses an early segment on slow material, which makes
   * transients arrive ahead of the beat. A coarse scan followed by halving the
   * step keeps the search cheap; the small center bias discourages pulling the
   * join to the window edge on ambiguous material.
   */
  private seekBestOffset(position: number, lastBase: number): number {
    const seekLength = this.seekLength;
    let bestOffset = 0;
    let bestScore = -Infinity;
    let bestCorrelation = 0;
    const step = Math.max(1, Math.floor(seekLength / 10));
    for (let candidate = -seekLength; candidate <= seekLength; candidate += step) {
      if (position + candidate < this.startFrame || position + candidate > lastBase) {
        continue;
      }
      const score = this.probe(position + candidate);
      const centered = candidate / seekLength;
      const biased = score - CENTER_BIAS * centered * centered;
      if (biased > bestScore) {
        bestScore = biased;
        bestOffset = candidate;
        bestCorrelation = this.probeOverlap;
      }
    }
    const center = this.probe(position);
    if (center > bestScore) {
      bestScore = center;
      bestOffset = 0;
      bestCorrelation = this.probeOverlap;
    }
    let refinementStep = Math.max(1, Math.floor(step / 2));
    while (refinementStep >= 1) {
      for (let direction = -1; direction <= 1; direction += 2) {
        const candidate = bestOffset + direction * refinementStep;
        if (position + candidate < this.startFrame || position + candidate > lastBase) {
          continue;
        }
        const score = this.probe(position + candidate);
        const centered = candidate / seekLength;
        const biased = score - CENTER_BIAS * centered * centered;
        if (biased > bestScore) {
          bestScore = biased;
          bestOffset = candidate;
          bestCorrelation = this.probeOverlap;
        }
      }
      if (refinementStep === 1) {
        break;
      }
      refinementStep = Math.max(1, Math.floor(refinementStep / 2));
    }
    this.lastSearchCorrelation = bestCorrelation;
    return bestOffset;
  }

  /**
   * Windowed normalized correlation between the previous output tail and a
   * candidate head. The score mixes a long reference window for robust
   * alignment with the actual join window, so the chosen offset also matches
   * what the crossfade will mix.
   */
  private probe(position: number): number {
    const overlap = this.overlapLength;
    let correlation = 0;
    let referenceEnergy = 0;
    let candidateEnergy = 0;
    let overlapCorrelation = 0;
    let overlapReferenceEnergy = 0;
    let overlapCandidateEnergy = 0;
    for (let channel = 0; channel < this.channelCount; channel += 1) {
      const source = this.channels[channel];
      const mid = this.midBuffers[channel];
      for (let sample = 0; sample < this.referenceLength; sample += 1) {
        const window = this.correlationWindow[sample];
        const reference = mid[sample] * window;
        const candidate = this.read(source, position + sample) * window;
        const product = reference * candidate;
        correlation += product;
        referenceEnergy += reference * reference;
        candidateEnergy += candidate * candidate;
        if (sample < overlap) {
          overlapCorrelation += product;
          overlapReferenceEnergy += reference * reference;
          overlapCandidateEnergy += candidate * candidate;
        }
      }
    }
    const longDenominator = Math.sqrt(referenceEnergy * candidateEnergy);
    const overlapDenominator = Math.sqrt(overlapReferenceEnergy * overlapCandidateEnergy);
    this.probeLong = longDenominator > 1e-12 ? correlation / longDenominator : 0;
    this.probeOverlap = overlapDenominator > 1e-12 ? overlapCorrelation / overlapDenominator : 0;
    return (
      this.probeLong * LONG_CORRELATION_WEIGHT + this.probeOverlap * (1 - LONG_CORRELATION_WEIGHT)
    );
  }

  /**
   * Find the first onset at or after an input frame. Each grain searches its
   * own input range because correlation can move a grain backward.
   */
  private firstTransientAt(frame: number): number {
    let low = 0;
    let high = this.transients.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.transients[middle] < frame) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }

  /** Translate an input onset to its frame on the output clock. */
  private transientOutputFrame(transient: number): number {
    return Math.round((transient - this.startFrame) / this.rate);
  }

  /** Carry an attack and its body across grain joins on the same source clock. */
  private alignedBase(batchStart: number): number | null {
    const earliest = Math.max(0, batchStart - this.transientBodyFrames);
    const end = batchStart + this.batchLength + this.overlapLength;
    let index = this.firstTransientAt(this.startFrame + (earliest - 0.5) * this.rate);
    if (index === this.transients.length) {
      return null;
    }
    let target = this.transientOutputFrame(this.transients[index]);
    if (target < batchStart) {
      // A new attack in this grain takes precedence over the decay of a close one.
      const next = this.firstTransientAt(this.startFrame + (batchStart - 0.5) * this.rate);
      if (next < this.transients.length) {
        const nextTarget = this.transientOutputFrame(this.transients[next]);
        if (nextTarget < end) {
          index = next;
          target = nextTarget;
        }
      }
    }
    const transient = this.transients[index];
    const base = transient - (target - batchStart);
    if (target >= end || base < this.startFrame) {
      return null;
    }
    // A continuing attack can return to the bounded grain search near the song end.
    const frames = Math.min(this.batchLength, this.targetFrames - batchStart);
    return target < batchStart && base + frames > this.length ? null : base;
  }

  /** Replace onset copies that would play away from their intended output frame. */
  private prepareSuppressions(base: number, batchStart: number): void {
    this.suppressionCount = 0;
    const transients = this.transients;
    const emittedEnd = base + this.batchLength + this.referenceLength;
    for (
      let index = this.firstTransientAt(base - (this.suppressionLength - this.suppressionPre));
      index < transients.length && this.suppressionCount < MAX_SUPPRESSIONS;
      index += 1
    ) {
      const transient = transients[index];
      if (transient >= emittedEnd) {
        break;
      }
      const outputPosition = batchStart + (transient - base);
      const target = this.transientOutputFrame(transient);
      // The first grain starts at the requested seek frame and can play an
      // imminent attack directly before later grains take over its timing.
      if (
        outputPosition === target ||
        (this.firstBatch && target >= 0 && target < this.batchLength)
      ) {
        continue;
      }
      this.suppressionPositions[this.suppressionCount] = outputPosition;
      this.suppressionOffsets[this.suppressionCount] = this.replacementOffset(index);
      this.suppressionCount += 1;
    }
  }

  /** Find a nearby continuation in phase with the lead-in to a displaced onset. */
  private replacementOffset(onset: number): number {
    const cached = this.transientReplacementOffsets[onset];
    if (cached) {
      return cached;
    }
    const start = this.transients[onset] - this.suppressionPre;
    const referenceFrames = Math.max(8, Math.floor(this.overlapLength / 3));
    const first = this.suppressionLength + referenceFrames;
    const next = this.transients[onset + 1];
    const nextStart = next === undefined ? this.length : next - this.suppressionPre;
    const last = Math.min(first + this.overlapLength, nextStart - start - this.suppressionLength);
    const previous = this.transients[onset - 1] ?? -this.suppressionLength;
    const previousEnd = Math.max(this.startFrame, previous + this.suppressionLength);
    const previousRoom = start - previousEnd;
    // Use the earlier clean region when the onset has no usable decay ahead.
    let best =
      last < this.suppressionPre && previousRoom >= this.suppressionLength
        ? -this.suppressionLength
        : Math.max(1, Math.min(first, last));
    let bestScore = -Infinity;
    for (let offset = first; offset <= last; offset += 4) {
      let dot = 0;
      let power = 0;
      for (const source of this.channels) {
        for (let frame = start - referenceFrames; frame < start; frame += 4) {
          const sample = this.read(source, frame + offset);
          dot += this.read(source, frame) * sample;
          power += sample * sample;
        }
      }
      const score = power > 1e-12 ? dot / Math.sqrt(power) : 0;
      if (score > bestScore) {
        bestScore = score;
        best = offset;
      }
    }
    this.transientReplacementOffsets[onset] = best;
    return best;
  }

  /** Read one source sample, fading displaced onset copies into surrounding audio. */
  private renderSample(source: Float32Array, index: number, outputPosition: number): number {
    const value = this.read(source, index);
    for (let position = 0; position < this.suppressionCount; position += 1) {
      const start = this.suppressionPositions[position] - this.suppressionPre;
      const end = start + this.suppressionLength;
      if (outputPosition < start || outputPosition > end) {
        continue;
      }
      const mix = Math.sin((Math.PI * (outputPosition - start)) / this.suppressionLength);
      const weight = mix * mix;
      const shifted = this.read(source, index + this.suppressionOffsets[position]);
      return value * (1 - weight) + shifted * weight;
    }
    return value;
  }

  /** Read one sample, treating out-of-range indices as silence. */
  private read(source: Float32Array, index: number): number {
    return index >= 0 && index < source.length ? source[index] : 0;
  }
}
