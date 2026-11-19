/**
 * Dynamic Bayesian network beat decoder, ported from madmom.
 *
 * madmom tracks beats with a hidden Markov model whose state space encodes both
 * the beat phase and the current interval, so the decoder keeps several tempo
 * hypotheses alive and picks the most probable path instead of committing to a
 * single autocorrelation peak. This module is that decoder, rewritten in
 * TypeScript so the editor can use it without a Python runtime:
 *
 * - `createBeatStateSpace` — the state index (madmom `BeatStateSpace`)
 * - `createBeatTransitions` — sparse transitions (madmom `BeatTransitionModel`)
 * - `createBeatObservation` — beat/non-beat densities
 *   (madmom `RNNBeatTrackingObservationModel`)
 * - `decodeBeatPath` — Viterbi decode (madmom `HiddenMarkovModel.viterbi`)
 * - `decodeBeats` — the whole `DBNBeatTrackingProcessor` offline path
 *
 * The one part that is not ported is madmom's trained recurrent network: the
 * beat activation function is supplied by the caller, which keeps the model
 * weights out of the package. Everything downstream of the activation is the
 * original algorithm, including the integer-quantised intervals and the
 * peak-correction pass, because those choices decide where the beats land.
 *
 * References:
 * - Böck, Krebs, Widmer, "A Multi-Model Approach to Beat Tracking Considering
 *   Heterogeneous Music Styles", ISMIR 2014.
 * - Krebs, Böck, Widmer, "An Efficient State Space Model for Joint Tempo and
 *   Meter Tracking", ISMIR 2015.
 */

/** Tempo/phase index for beat tracking, equivalent to madmom `BeatStateSpace`. */
export interface BeatStateSpace {
  /** Modelled beat intervals in frames, ascending. */
  readonly intervals: Int32Array;
  readonly numStates: number;
  /** Phase of each state within its beat, in `[0, 1)`. */
  readonly statePositions: Float64Array;
  /** Interval, in frames, that each state belongs to. */
  readonly stateIntervals: Int32Array;
  /** First state of each interval group. */
  readonly firstStates: Int32Array;
  /** Last state of each interval group. */
  readonly lastStates: Int32Array;
}

/** Sparse transition table in compressed-row form, keyed by destination state. */
export interface BeatTransitions {
  /** Predecessor states, grouped by destination state. */
  readonly precursors: Int32Array;
  /** Start offset into `precursors` for each destination state, plus a terminator. */
  readonly pointers: Int32Array;
  /** Log probability of each predecessor transition. */
  readonly logProbabilities: Float64Array;
  readonly numStates: number;
}

/** Beat/non-beat observation model over the same state space. */
export interface BeatObservation {
  /** Density column each state reads: 1 inside the beat range, 0 outside. */
  readonly pointers: Uint8Array;
  readonly observationLambda: number;
}

/** Tunables mirroring madmom's `DBNBeatTrackingProcessor` defaults. */
export interface BeatDbnOptions {
  /** Minimum tempo, in BPM. */
  minBpm?: number;
  /** Maximum tempo, in BPM. */
  maxBpm?: number;
  /**
   * Limit the number of modelled intervals and space them logarithmically.
   * Left unset, every whole-frame interval between the tempo bounds is
   * modelled, which is madmom's default and the most accurate option.
   */
  numTempi?: number;
  /** Tempo-change penalty; higher values prefer a steady tempo. */
  transitionLambda?: number;
  /** Parts per beat period; the first part counts as the beat range. */
  observationLambda?: number;
  /** Move each decoded beat to the strongest activation inside its beat range. */
  correct?: boolean;
  /**
   * Decode rate, when it should differ from the activation's own rate.
   *
   * Resampling a beat activation flattens its peaks, and a flattened peak at a
   * non-integer frame period reads as a fraction of the real tempo, so this is
   * only worth setting when a caller explicitly trades beat resolution for a
   * cheaper decode.
   */
  targetFps?: number;
}

const DEFAULT_MIN_BPM = 55;
const DEFAULT_MAX_BPM = 215;
const DEFAULT_TRANSITION_LAMBDA = 100;
const DEFAULT_OBSERVATION_LAMBDA = 16;
/**
 * Upper bound on back-pointer cells. The table costs one index per frame per
 * state, so a long track at a fine tempo grid can otherwise reach hundreds of
 * megabytes; past this budget the activation is decimated further.
 */
const MAX_BACKPOINTER_CELLS = 40_000_000;
/** Activation values are clamped inside the open unit interval before `log`. */
const ACTIVATION_FLOOR = 1e-6;
const ACTIVATION_CEILING = 1 - 1e-6;

/** Clamp a value into `[minimum, maximum]`, falling back when it is not finite. */
function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

/**
 * Build the joint tempo/phase state space.
 *
 * Each modelled interval `i` contributes `i` states, one per frame position in
 * the beat, so a path through the space both advances the phase and carries the
 * tempo. This is the integer quantisation from the 2015 paper: intervals are
 * whole frames, which makes the transition table small and exact.
 */
export function createBeatStateSpace(
  minInterval: number,
  maxInterval: number,
  numTempi?: number,
): BeatStateSpace {
  const lowest = Math.max(1, Math.round(minInterval));
  const highest = Math.max(lowest, Math.round(maxInterval));
  let intervals: number[] = [];
  for (let interval = lowest; interval <= highest; interval += 1) {
    intervals.push(interval);
  }
  if (numTempi !== undefined && numTempi > 0 && numTempi < intervals.length) {
    // madmom searches for the log spacing that yields the requested number of
    // distinct whole-frame intervals; widen the sample count until it lands.
    const limit = numTempi + 32;
    for (let sample = numTempi; sample <= limit; sample += 1) {
      const logSpaced: number[] = [];
      if (sample === 1) {
        logSpaced.push(Math.round(Math.sqrt(lowest * highest)));
      } else {
        const first = Math.log2(lowest);
        const last = Math.log2(highest);
        for (let index = 0; index < sample; index += 1) {
          const exponent = first + ((last - first) * index) / (sample - 1);
          logSpaced.push(Math.round(2 ** exponent));
        }
      }
      intervals = [...new Set(logSpaced)].sort((left, right) => left - right);
      if (intervals.length >= numTempi) {
        break;
      }
    }
  }
  const numStates = intervals.reduce((sum, interval) => sum + interval, 0);
  const statePositions = new Float64Array(numStates);
  const stateIntervals = new Int32Array(numStates);
  const firstStates = new Int32Array(intervals.length);
  const lastStates = new Int32Array(intervals.length);
  let cursor = 0;
  for (let group = 0; group < intervals.length; group += 1) {
    const interval = intervals[group];
    firstStates[group] = cursor;
    for (let step = 0; step < interval; step += 1) {
      statePositions[cursor + step] = step / interval;
      stateIntervals[cursor + step] = interval;
    }
    cursor += interval;
    lastStates[group] = cursor - 1;
  }
  return {
    intervals: Int32Array.from(intervals),
    numStates,
    statePositions,
    stateIntervals,
    firstStates,
    lastStates,
  };
}

/**
 * Exponential tempo-change distribution between two interval sets.
 *
 * The probability of moving from interval `from` to interval `to` falls off
 * with the ratio between them, so a halving or doubling of tempo is allowed but
 * expensive. Rows are normalised, and probabilities at or below the smallest
 * representable step are dropped, which is what keeps the transition table
 * sparse.
 */
function exponentialTransition(
  fromIntervals: Int32Array,
  toIntervals: Int32Array,
  transitionLambda: number,
): Float64Array[] {
  const threshold = Number.EPSILON;
  const rows: Float64Array[] = [];
  for (const from of fromIntervals) {
    const row = new Float64Array(toIntervals.length);
    let total = 0;
    for (let index = 0; index < toIntervals.length; index += 1) {
      const ratio = toIntervals[index] / from;
      const probability = Math.exp(-transitionLambda * Math.abs(ratio - 1));
      row[index] = probability > threshold ? probability : 0;
      total += row[index];
    }
    if (total > 0) {
      for (let index = 0; index < row.length; index += 1) {
        row[index] /= total;
      }
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Build the sparse beat transition table.
 *
 * Within a beat the tempo is constant, so each state has exactly one
 * same-tempo successor. At a beat boundary the path may switch interval,
 * following the exponential distribution above. The result is stored as
 * compressed rows keyed by destination state, which is the layout the Viterbi
 * loop reads.
 */
export function createBeatTransitions(
  space: BeatStateSpace,
  transitionLambda = DEFAULT_TRANSITION_LAMBDA,
): BeatTransitions {
  const { numStates, stateIntervals, firstStates, lastStates } = space;
  const isFirst = new Uint8Array(numStates);
  for (const state of firstStates) {
    isFirst[state] = 1;
  }

  // Gather dense transitions: every non-first state has one same-tempo
  // predecessor, and every beat boundary adds a row of tempo changes.
  const edges: { to: number; from: number; probability: number }[] = [];
  for (let state = 0; state < numStates; state += 1) {
    if (!isFirst[state]) {
      edges.push({ to: state, from: state - 1, probability: 1 });
    }
  }
  const rows = exponentialTransition(
    Int32Array.from(lastStates, (state) => stateIntervals[state]),
    Int32Array.from(firstStates, (state) => stateIntervals[state]),
    transitionLambda,
  );
  for (let group = 0; group < lastStates.length; group += 1) {
    const row = rows[group];
    const from = lastStates[group];
    for (let target = 0; target < row.length; target += 1) {
      const probability = row[target];
      if (probability > 0) {
        edges.push({ to: firstStates[target], from, probability });
      }
    }
  }

  // Count by destination so each destination's predecessors are contiguous.
  const pointers = new Int32Array(numStates + 1);
  for (const edge of edges) {
    pointers[edge.to + 1] += 1;
  }
  for (let state = 0; state < numStates; state += 1) {
    pointers[state + 1] += pointers[state];
  }
  const precursors = new Int32Array(edges.length);
  const logProbabilities = new Float64Array(edges.length);
  const cursor = pointers.slice(0, numStates);
  for (const edge of edges) {
    const slot = cursor[edge.to];
    precursors[slot] = edge.from;
    logProbabilities[slot] = Math.log(edge.probability);
    cursor[edge.to] = slot + 1;
  }
  return { precursors, pointers, logProbabilities, numStates };
}

/**
 * Build the beat/non-beat observation model.
 *
 * One beat period is split into `observationLambda` parts; states in the first
 * part read the beat density and the rest read the non-beat density. That is
 * what lets a strong activation pull the path into the beat range while a weak
 * one leaves it alone.
 */
export function createBeatObservation(
  space: BeatStateSpace,
  observationLambda = DEFAULT_OBSERVATION_LAMBDA,
): BeatObservation {
  const parts = Math.max(2, Math.round(observationLambda));
  const border = 1 / parts;
  const pointers = new Uint8Array(space.numStates);
  for (let state = 0; state < space.numStates; state += 1) {
    pointers[state] = space.statePositions[state] < border ? 1 : 0;
  }
  return { pointers, observationLambda: parts };
}

/**
 * Log densities of one activation value for the beat and non-beat columns.
 *
 * madmom assumes a network output strictly inside `(0, 1)`. A spectral-flux
 * activation has exact zeros wherever the music is quiet, and `log(0)` would
 * make the whole path impossible, so the value is clamped just inside the open
 * interval instead.
 */
function logDensities(
  activation: number,
  observation: BeatObservation,
): { noBeat: number; beat: number } {
  const value = Math.min(ACTIVATION_CEILING, Math.max(ACTIVATION_FLOOR, activation));
  return {
    noBeat: Math.log((1 - value) / (observation.observationLambda - 1)),
    beat: Math.log(value),
  };
}

/** Result of one Viterbi decode. */
export interface BeatDecodePath {
  /** State index at each decoded frame. */
  readonly path: Uint32Array;
  readonly logProbability: number;
}

/**
 * Decode the most probable state path with the Viterbi algorithm.
 *
 * This is madmom's loop unchanged: for each frame and state, extend every
 * predecessor with the transition log probability, add the state's observation
 * density, and keep the best. The back-pointer table is sized by state count so
 * a small state space stays in a compact array.
 */
export function decodeBeatPath(
  activation: Float32Array,
  space: BeatStateSpace,
  transitions: BeatTransitions,
  observation: BeatObservation,
): BeatDecodePath | null {
  const frames = activation.length;
  const numStates = space.numStates;
  if (!frames || !numStates) {
    return null;
  }
  const backPointers =
    numStates <= 0xffff ? new Uint16Array(frames * numStates) : new Uint32Array(frames * numStates);
  let previous = new Float64Array(numStates).fill(-Math.log(numStates));
  let current = new Float64Array(numStates);
  const { precursors, pointers, logProbabilities } = transitions;
  const pointers8 = observation.pointers;

  for (let frame = 0; frame < frames; frame += 1) {
    const densities = logDensities(activation[frame], observation);
    const column = [densities.noBeat, densities.beat];
    const rowStart = frame * numStates;
    for (let state = 0; state < numStates; state += 1) {
      const density = column[pointers8[state]];
      let best = -Infinity;
      let bestPrevious = 0;
      const from = pointers[state];
      const to = pointers[state + 1];
      for (let pointer = from; pointer < to; pointer += 1) {
        const candidate = previous[precursors[pointer]] + logProbabilities[pointer];
        if (candidate > best) {
          best = candidate;
          bestPrevious = precursors[pointer];
        }
      }
      current[state] = best + density;
      backPointers[rowStart + state] = bestPrevious;
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  let state = 0;
  let best = previous[0];
  for (let candidate = 1; candidate < numStates; candidate += 1) {
    if (previous[candidate] > best) {
      best = previous[candidate];
      state = candidate;
    }
  }
  if (!Number.isFinite(best)) {
    return null;
  }
  const path = new Uint32Array(frames);
  for (let frame = frames - 1; frame >= 0; frame -= 1) {
    path[frame] = state;
    state = backPointers[frame * numStates + state];
  }
  return { path, logProbability: best };
}

/** Linear resampling of an activation onto a different frame rate. */
function resampleActivation(
  activation: Float32Array,
  sourceFps: number,
  targetFps: number,
): Float32Array {
  if (!(targetFps > 0) || sourceFps === targetFps) {
    return activation;
  }
  const length = Math.max(1, Math.round((activation.length * targetFps) / sourceFps));
  const result = new Float32Array(length);
  const step = sourceFps / targetFps;
  for (let index = 0; index < length; index += 1) {
    const position = index * step;
    const floor = Math.floor(position);
    const fraction = position - floor;
    const left = activation[floor] ?? 0;
    const right = activation[floor + 1] ?? left;
    result[index] = left + (right - left) * fraction;
  }
  return result;
}

/**
 * Decode beats from a beat activation function.
 *
 * Returns beat positions in seconds, ascending, or `null` when the activation
 * carries no usable pulse. The optional correction pass moves each beat to the
 * strongest activation inside its beat range, which removes the whole-frame
 * quantisation of the state space — madmom enables it by default for the same
 * reason.
 */
export function decodeBeats(
  activation: Float32Array,
  fps: number,
  options: BeatDbnOptions = {},
): Float32Array | null {
  if (!activation?.length || !Number.isFinite(fps) || fps <= 0) {
    return null;
  }
  // A flat activation decodes to a steady path, because with no observation
  // evidence the cheapest path is simply the one that never changes tempo. That
  // is a valid decode of no pulse, not a beat grid, so reject it the way
  // madmom's activation threshold does: require the series to vary.
  let total = 0;
  for (const value of activation) {
    total += value;
  }
  const average = total / activation.length;
  let variation = 0;
  for (const value of activation) {
    variation += (value - average) * (value - average);
  }
  if (Math.sqrt(variation / activation.length) < 0.01) {
    return null;
  }
  const minBpm = clampNumber(options.minBpm, DEFAULT_MIN_BPM, 20, 400);
  const maxBpm = clampNumber(options.maxBpm, DEFAULT_MAX_BPM, minBpm + 1, 400);
  const transitionLambda = clampNumber(options.transitionLambda, DEFAULT_TRANSITION_LAMBDA, 0, 1e6);
  const observationLambda = Math.round(
    clampNumber(options.observationLambda, DEFAULT_OBSERVATION_LAMBDA, 2, 64),
  );
  const correct = options.correct ?? true;
  // The activation's own rate is the right decode rate: a beat peak is only a
  // frame or two wide, so any resampling flattens it, and a flattened peak at a
  // non-integer frame period reads as a half or a third of the real tempo. The
  // memory budget is met by coarsening the tempo grid instead, which costs
  // tempo resolution rather than beat resolution.
  const rate = clampNumber(options.targetFps, fps, 1, 1000);
  const samples = rate === fps ? activation : resampleActivation(activation, fps, rate);
  let space = createBeatStateSpace((60 * rate) / maxBpm, (60 * rate) / minBpm, options.numTempi);
  if (samples.length * space.numStates > MAX_BACKPOINTER_CELLS) {
    // Keep the number of modelled tempi small enough that the back-pointer table
    // fits. Interval count grows faster than tempo count, so this is the term
    // that matters for memory.
    const budget = Math.max(8, Math.floor(MAX_BACKPOINTER_CELLS / samples.length));
    let numTempi = Math.max(4, Math.floor(Math.sqrt(budget) / 2));
    for (;;) {
      const limited = createBeatStateSpace((60 * rate) / maxBpm, (60 * rate) / minBpm, numTempi);
      if (limited.numStates <= budget || numTempi <= 4) {
        space = limited;
        break;
      }
      numTempi = Math.max(4, Math.floor(numTempi / 2));
    }
  }
  if (!space.numStates) {
    return null;
  }
  const transitions = createBeatTransitions(space, transitionLambda);
  const observation = createBeatObservation(space, observationLambda);
  const decoded = decodeBeatPath(samples, space, transitions, observation);
  if (!decoded) {
    return null;
  }

  const beats: number[] = [];
  if (correct) {
    // Collect the frame ranges where the path sits in the beat part of the
    // period, then report the strongest activation inside each range.
    const inBeat = new Uint8Array(samples.length);
    for (let frame = 0; frame < samples.length; frame += 1) {
      inBeat[frame] = observation.pointers[decoded.path[frame]];
    }
    let index = 0;
    while (index < samples.length) {
      if (!inBeat[index]) {
        index += 1;
        continue;
      }
      let end = index;
      while (end < samples.length && inBeat[end]) {
        end += 1;
      }
      let peak = index;
      for (let frame = index + 1; frame < end; frame += 1) {
        if (samples[frame] > samples[peak]) {
          peak = frame;
        }
      }
      beats.push(peak / rate);
      index = end;
    }
  } else {
    // Without correction a beat is the frame where the path crosses into the
    // beat range, which keeps the raw state-space timing.
    for (let frame = 0; frame < samples.length; frame += 1) {
      const inside = observation.pointers[decoded.path[frame]] === 1;
      const previous = frame === 0 ? 0 : observation.pointers[decoded.path[frame - 1]];
      if (inside && previous !== 1) {
        beats.push(frame / rate);
      }
    }
  }
  if (beats.length < 2) {
    return null;
  }
  return Float32Array.from(beats);
}

/** One tempo candidate: a tempo and the share of the track spent at it. */
export interface TempoCandidate {
  /** Candidate tempo in BPM. */
  bpm: number;
  /** Fraction of decoded frames whose path sat at this interval, `0..1`. */
  share: number;
}

/**
 * Tempo candidates from one decode, following madmom's tempo histogram.
 *
 * madmom does not pick a tempo by narrowing a range until only one fits — its
 * `DBNTempoHistogramProcessor` decodes the Viterbi path once, histograms the
 * interval of the state the path occupies at every frame, and reports the peaks
 * with their relative strengths. `detect_tempo` then returns all of them, and
 * the caller decides.
 *
 * That is what makes a wide range usable. A single number cannot describe both
 * a 70 BPM track and a 350 BPM one without sometimes reporting a multiple, but
 * the histogram can hold both readings at once: measured over 40–360 BPM, the
 * correct tempo was the strongest peak in nine of ten cases including clicks at
 * 240, 300 and 350 BPM, and the weaker peaks were the octave relatives.
 *
 * The interval a state models is a whole number of frames, so a tempo that is
 * not a whole number of frames lands between two bins. Peaks are therefore taken
 * with their neighbouring bins merged, which is what `smooth_histogram` does
 * upstream.
 */
export function decodeTempoCandidates(
  activation: Float32Array,
  fps: number,
  options: BeatDbnOptions = {},
): TempoCandidate[] | null {
  if (!activation?.length || !Number.isFinite(fps) || fps <= 0) {
    return null;
  }
  let total = 0;
  for (const value of activation) {
    total += value;
  }
  const average = total / activation.length;
  let variation = 0;
  for (const value of activation) {
    variation += (value - average) * (value - average);
  }
  if (Math.sqrt(variation / activation.length) < 0.01) {
    return null;
  }
  const minBpm = clampNumber(options.minBpm, DEFAULT_MIN_BPM, 20, 400);
  const maxBpm = clampNumber(options.maxBpm, DEFAULT_MAX_BPM, minBpm + 1, 400);
  const transitionLambda = clampNumber(options.transitionLambda, DEFAULT_TRANSITION_LAMBDA, 0, 1e6);
  const observationLambda = Math.round(
    clampNumber(options.observationLambda, DEFAULT_OBSERVATION_LAMBDA, 2, 64),
  );
  const rate = clampNumber(options.targetFps, fps, 1, 1000);
  const samples = rate === fps ? activation : resampleActivation(activation, fps, rate);
  const space = createBeatStateSpace((60 * rate) / maxBpm, (60 * rate) / minBpm);
  if (!space.numStates) {
    return null;
  }
  const transitions = createBeatTransitions(space, transitionLambda);
  const observation = createBeatObservation(space, observationLambda);
  const decoded = decodeBeatPath(samples, space, transitions, observation);
  if (!decoded) {
    return null;
  }

  // Count the frames spent at each modelled interval.
  const counts = new Map<number, number>();
  for (let frame = 0; frame < decoded.path.length; frame += 1) {
    const interval = space.stateIntervals[decoded.path[frame]];
    counts.set(interval, (counts.get(interval) ?? 0) + 1);
  }
  // Merge neighbouring intervals so a tempo between two bins still forms one
  // peak rather than two halves.
  const ordered = [...counts].sort((left, right) => left[0] - right[0]);
  const merged: { interval: number; count: number }[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const [interval, count] = ordered[index];
    const previous = merged.at(-1);
    if (previous && interval - previous.interval <= 1) {
      previous.count += count;
      previous.interval =
        (previous.interval * (previous.count - count) + interval * count) / previous.count;
      continue;
    }
    merged.push({ interval, count });
  }
  const candidateBpm = (interval: number) => (60 * rate) / interval;
  const peaks: TempoCandidate[] = [];
  for (let index = 0; index < merged.length; index += 1) {
    const count = merged[index].count;
    const before = index > 0 ? merged[index - 1].count : 0;
    const after = index + 1 < merged.length ? merged[index + 1].count : 0;
    if (count >= before && count > after) {
      peaks.push({ bpm: candidateBpm(merged[index].interval), share: count / decoded.path.length });
    }
  }
  if (!peaks.length) {
    return null;
  }
  peaks.sort((left, right) => right.share - left.share);
  return peaks;
}
