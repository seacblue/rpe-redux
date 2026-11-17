/* eslint-disable max-lines -- event tracks and floor integration share one sampling contract. */
/** Event tracks and speed integration used by the scene runtime. */
import { channelInteger } from "../chart.ts";
import { lowerBound, upperBound } from "../../../utils/search.ts";
import {
  bezier,
  easing,
  easingIntegral,
  easingParameters,
  easingWithKnownRange,
  easingWithRange,
} from "../../../utils/easing.ts";
import { trajectoryEventValue } from "../trajectory/curveTrajectory.ts";
import type { JudgeLineEvent, LineEventValue } from "../chart.ts";
import { isOrderedBeatRange } from "./beat.ts";
import { compactFlatNumericEvents } from "./eventCompaction.ts";

let eventCursorHits = 0;
let eventCursorMisses = 0;
let eventCursorStatsEnabled = true;

/** Enable cursor counters only for an active detailed renderer profile. */
export function setEventTrackSamplingStatsEnabled(enabled: boolean): void {
  eventCursorStatsEnabled = enabled;
}

/** Reset low-overhead event cursor counters before a profiled frame. */
export function resetEventTrackSamplingStats(): void {
  eventCursorHits = 0;
  eventCursorMisses = 0;
}

/** Read event cursor counters without exposing track internals. */
export function eventTrackSamplingStats(): {
  readonly cursorHits: number;
  readonly cursorMisses: number;
} {
  return { cursorHits: eventCursorHits, cursorMisses: eventCursorMisses };
}

/** The only `TempoMap` surface the tracks need: beats (or beat tuples) to seconds. */
export interface TempoSource {
  seconds(beat: number | readonly number[], factor?: number): number;
}

/** One event paired with its resolved start/end seconds. */
export interface TimedEvent<T> {
  event: T;
  start: number;
  end: number;
}

/** One event paired with its resolved seconds and its integrated speed prefix. */
export interface IntegralEntry<T> extends TimedEvent<T> {
  prefix: number;
  prefixEnd: number;
}

/** Grow a compiled table by appending the new tail values. */
function appendFloat64(source: Float64Array, values: readonly number[]): Float64Array {
  const next = new Float64Array(source.length + values.length);
  next.set(source);
  next.set(values, source.length);
  return next;
}

/** Grow a compiled integer table by appending the new tail values. */
function appendInt16(source: Int16Array, values: readonly number[]): Int16Array {
  const next = new Int16Array(source.length + values.length);
  next.set(source);
  next.set(values, source.length);
  return next;
}

/** Grow a compiled flag table by appending the new tail values. */
function appendUint8(source: Uint8Array, values: readonly number[]): Uint8Array {
  const next = new Uint8Array(source.length + values.length);
  next.set(source);
  next.set(values, source.length);
  return next;
}

/** A compiled event track sampled at chart time in seconds. */
export class EventTrack<T extends JudgeLineEvent = JudgeLineEvent> {
  declare fallback: LineEventValue;
  declare integerEndpoints: boolean;
  /** Raw event list this track was compiled from; compacted events stay here. */
  declare rawSources: readonly T[];
  declare sources: T[];
  declare starts: Float64Array;
  declare ends: Float64Array;
  declare inverseDurations: Float64Array;
  declare startValues: Float64Array;
  declare endValues: Float64Array;
  declare normalizedStartValues: Float64Array;
  declare normalizedEndValues: Float64Array;
  declare easingTypes: Int16Array;
  declare easingLefts: Float64Array;
  declare easingRights: Float64Array;
  declare easingBases: Float64Array;
  declare easingRanges: Float64Array;
  declare easingRangeValid: Uint8Array;
  declare bezierFlags: Uint8Array;
  declare linearFlags: Uint8Array;
  declare numericOnly: boolean;
  declare linearNumeric: boolean;
  declare tempo: TempoSource;
  declare factor: number;
  private cachedValueEntry: TimedEvent<T> | null = null;
  private cachedValueIndex = 0;
  private cachedValueSeconds = Number.NaN;
  /** Compile `events` into sorted lookup tables; `fallback` applies before the first event. */
  constructor(
    events: readonly T[] | undefined,
    tempo: TempoSource,
    factor = 1,
    fallback: LineEventValue = 0,
    integerEndpoints = false,
  ) {
    this.fallback = fallback;
    this.integerEndpoints = integerEndpoints;
    this.rawSources = events ?? [];
    this.tempo = tempo;
    this.factor = factor;
    const ordered = (events ?? [])
      .map((event) => ({
        event,
        start: tempo.seconds(event.startTime, factor),
        end: tempo.seconds(event.endTime, factor),
      }))
      .filter((entry) => isOrderedBeatRange(entry.event.startTime, entry.event.endTime))
      .sort((a, b) => a.start - b.start);
    const compacted = compactFlatNumericEvents(ordered);
    // A flat event that repeats the prior state is only a serialized plateau marker;
    // retain its head only when removing it cannot change an overlapping event.
    this.sources = compacted.map((entry) => entry.event);
    this.starts = Float64Array.from(compacted, (entry) => entry.start);
    this.ends = Float64Array.from(compacted, (entry) => entry.end);
    this.inverseDurations = Float64Array.from(compacted, (entry) =>
      entry.end > entry.start ? 1 / (entry.end - entry.start) : 0,
    );
    this.startValues = Float64Array.from(compacted, (entry) => Number(entry.event.start));
    this.endValues = Float64Array.from(compacted, (entry) => Number(entry.event.end));
    this.normalizedStartValues = Float64Array.from(this.startValues, (value) =>
      integerEndpoints ? channelInteger(value) : value,
    );
    this.normalizedEndValues = Float64Array.from(this.endValues, (value) =>
      integerEndpoints ? channelInteger(value) : value,
    );
    this.easingTypes = Int16Array.from(compacted, (entry) => entry.event.easingType ?? 1);
    this.easingLefts = Float64Array.from(compacted, (entry) => entry.event.easingLeft ?? 0);
    this.easingRights = Float64Array.from(compacted, (entry) => entry.event.easingRight ?? 1);
    this.bezierFlags = Uint8Array.from(compacted, (entry) => (entry.event.bezier ? 1 : 0));
    this.numericOnly = compacted.every(
      (entry) =>
        !entry.event.trajectory &&
        typeof entry.event.start === "number" &&
        typeof entry.event.end === "number",
    );
    this.linearNumeric =
      this.numericOnly &&
      compacted.every((entry) => (entry.event.easingType ?? 1) === 1 && !entry.event.bezier);
    this.easingBases = Float64Array.from(compacted, (entry) => {
      const event = entry.event;
      return easingParameters(event.easingType ?? 1, event.easingLeft ?? 0, event.easingRight ?? 1)
        .base;
    });
    this.easingRanges = Float64Array.from(compacted, (entry, index) => {
      const event = entry.event;
      return easingParameters(event.easingType ?? 1, event.easingLeft ?? 0, event.easingRight ?? 1)
        .range;
    });
    this.easingRangeValid = Uint8Array.from(compacted, (entry, index) => {
      const event = entry.event;
      const width = (event.easingRight ?? 1) - (event.easingLeft ?? 0);
      const range = this.easingRanges[index];
      return Number.isFinite(range) && Math.abs(range) >= 1e-15 && Math.abs(width) >= 1e-15 ? 1 : 0;
    });
    this.linearFlags = Uint8Array.from(compacted, (entry) =>
      (entry.event.easingType ?? 1) === 1 ? 1 : 0,
    );
  }
  /** Reuse typed lookup tables when an edit only removed existing events. */
  withSources(sources: readonly T[]): EventTrack<T> {
    if (sources === this.sources) {
      return this;
    }
    if (sources.length === this.sources.length) {
      let same = true;
      for (let index = 0; index < sources.length; index += 1) {
        if (sources[index] !== this.sources[index]) {
          same = false;
          break;
        }
      }
      if (same) {
        return this;
      }
    }
    if (sources.length > this.rawSources.length) {
      let prefix = true;
      for (let index = 0; index < this.rawSources.length; index += 1) {
        if (sources[index] !== this.rawSources[index]) {
          prefix = false;
          break;
        }
      }
      if (prefix) {
        const appended = this.appendRawSources(sources);
        if (appended) {
          return appended;
        }
      }
    }
    if (sources.length <= this.sources.length) {
      const indices: number[] = [];
      let previous = 0;
      for (const source of sources) {
        let found = -1;
        for (let index = previous; index < this.sources.length; index += 1) {
          if (this.sources[index] === source) {
            found = index;
            break;
          }
        }
        if (found < 0) {
          indices.length = 0;
          break;
        }
        indices.push(found);
        previous = found + 1;
      }
      if (indices.length === sources.length || sources.length === 0) {
        const next = Object.create(EventTrack.prototype) as EventTrack<T>;
        Object.assign(next, this);
        next.rawSources = sources;
        next.sources = [...sources];
        next.starts = Float64Array.from(indices, (index) => this.starts[index]);
        next.ends = Float64Array.from(indices, (index) => this.ends[index]);
        next.inverseDurations = Float64Array.from(indices, (index) => this.inverseDurations[index]);
        next.startValues = Float64Array.from(indices, (index) => this.startValues[index]);
        next.endValues = Float64Array.from(indices, (index) => this.endValues[index]);
        next.normalizedStartValues = Float64Array.from(
          indices,
          (index) => this.normalizedStartValues[index],
        );
        next.normalizedEndValues = Float64Array.from(
          indices,
          (index) => this.normalizedEndValues[index],
        );
        next.easingTypes = Int16Array.from(indices, (index) => this.easingTypes[index]);
        next.easingLefts = Float64Array.from(indices, (index) => this.easingLefts[index]);
        next.easingRights = Float64Array.from(indices, (index) => this.easingRights[index]);
        next.easingBases = Float64Array.from(indices, (index) => this.easingBases[index]);
        next.easingRanges = Float64Array.from(indices, (index) => this.easingRanges[index]);
        next.easingRangeValid = Uint8Array.from(indices, (index) => this.easingRangeValid[index]);
        next.bezierFlags = Uint8Array.from(indices, (index) => this.bezierFlags[index]);
        next.linearFlags = Uint8Array.from(indices, (index) => this.linearFlags[index]);
        next.linearNumeric = this.linearNumeric;
        next.cachedValueEntry = null;
        next.cachedValueIndex = 0;
        next.cachedValueSeconds = Number.NaN;
        return next;
      }
    }
    return new EventTrack<T>(
      sources,
      this.tempo,
      this.factor,
      this.fallback,
      this.integerEndpoints,
    );
  }

  /**
   * Compile new tail events onto the existing tables.
   *
   * Returns null when the append would change compaction or sort order, so the
   * caller can fall back to a full rebuild. An append that stays ordered after
   * the compiled tail only needs new typed-array slots, which is what event
   * placement does on a dense line.
   */
  private appendRawSources(sources: readonly T[]): EventTrack<T> | null {
    const lastCount = this.sources.length;
    let previous = lastCount ? this.sources[lastCount - 1] : undefined;
    let previousEnd = lastCount ? this.ends[lastCount - 1] : Number.NEGATIVE_INFINITY;
    let lastStart = lastCount ? this.starts[lastCount - 1] : Number.NEGATIVE_INFINITY;
    const accepted: T[] = [];
    const starts: number[] = [];
    const ends: number[] = [];
    const inverseDurations: number[] = [];
    const startValues: number[] = [];
    const endValues: number[] = [];
    const normalizedStartValues: number[] = [];
    const normalizedEndValues: number[] = [];
    const easingTypes: number[] = [];
    const easingLefts: number[] = [];
    const easingRights: number[] = [];
    const easingBases: number[] = [];
    const easingRanges: number[] = [];
    const easingRangeValid: number[] = [];
    const bezierFlags: number[] = [];
    const linearFlags: number[] = [];
    let numericOnly = this.numericOnly;
    let linearNumeric = this.linearNumeric;
    for (let index = this.rawSources.length; index < sources.length; index += 1) {
      const event = sources[index];
      if (!isOrderedBeatRange(event.startTime, event.endTime)) {
        return null;
      }
      const start = this.tempo.seconds(event.startTime, this.factor);
      const end = this.tempo.seconds(event.endTime, this.factor);
      if (start < lastStart) {
        return null;
      }
      const flat =
        !event.trajectory && typeof event.start === "number" && event.start === event.end;
      const previousNumeric =
        previous !== undefined && !previous.trajectory && typeof previous.end === "number";
      const repeated =
        flat &&
        previous !== undefined &&
        !previous.trajectory &&
        typeof previous.start === "number" &&
        previous.start === previous.end &&
        previous.start === event.start;
      const trailingPlateau =
        flat &&
        previousNumeric &&
        previous !== undefined &&
        previous.end === event.start &&
        (previous.start === previous.end || previousEnd <= start);
      if (repeated || trailingPlateau) {
        return null;
      }
      const easingType = event.easingType ?? 1;
      const easing = easingParameters(easingType, event.easingLeft ?? 0, event.easingRight ?? 1);
      const width = (event.easingRight ?? 1) - (event.easingLeft ?? 0);
      numericOnly =
        numericOnly &&
        !event.trajectory &&
        typeof event.start === "number" &&
        typeof event.end === "number";
      linearNumeric = linearNumeric && easingType === 1 && !event.bezier;
      accepted.push(event);
      starts.push(start);
      ends.push(end);
      inverseDurations.push(end > start ? 1 / (end - start) : 0);
      const startValue = Number(event.start);
      const endValue = Number(event.end);
      startValues.push(startValue);
      endValues.push(endValue);
      normalizedStartValues.push(this.integerEndpoints ? channelInteger(startValue) : startValue);
      normalizedEndValues.push(this.integerEndpoints ? channelInteger(endValue) : endValue);
      easingTypes.push(easingType);
      easingLefts.push(event.easingLeft ?? 0);
      easingRights.push(event.easingRight ?? 1);
      easingBases.push(easing.base);
      easingRanges.push(easing.range);
      easingRangeValid.push(
        Number.isFinite(easing.range) && Math.abs(easing.range) >= 1e-15 && Math.abs(width) >= 1e-15
          ? 1
          : 0,
      );
      bezierFlags.push(event.bezier ? 1 : 0);
      linearFlags.push(easingType === 1 ? 1 : 0);
      previous = event;
      previousEnd = end;
      lastStart = start;
    }
    if (!accepted.length) {
      return null;
    }
    const next = Object.create(EventTrack.prototype) as EventTrack<T>;
    Object.assign(next, this);
    next.rawSources = sources;
    next.sources = [...this.sources, ...accepted];
    next.starts = appendFloat64(this.starts, starts);
    next.ends = appendFloat64(this.ends, ends);
    next.inverseDurations = appendFloat64(this.inverseDurations, inverseDurations);
    next.startValues = appendFloat64(this.startValues, startValues);
    next.endValues = appendFloat64(this.endValues, endValues);
    next.normalizedStartValues = appendFloat64(this.normalizedStartValues, normalizedStartValues);
    next.normalizedEndValues = appendFloat64(this.normalizedEndValues, normalizedEndValues);
    next.easingTypes = appendInt16(this.easingTypes, easingTypes);
    next.easingLefts = appendFloat64(this.easingLefts, easingLefts);
    next.easingRights = appendFloat64(this.easingRights, easingRights);
    next.easingBases = appendFloat64(this.easingBases, easingBases);
    next.easingRanges = appendFloat64(this.easingRanges, easingRanges);
    next.easingRangeValid = appendUint8(this.easingRangeValid, easingRangeValid);
    next.bezierFlags = appendUint8(this.bezierFlags, bezierFlags);
    next.linearFlags = appendUint8(this.linearFlags, linearFlags);
    next.numericOnly = numericOnly;
    next.linearNumeric = linearNumeric;
    next.cachedValueEntry = null;
    next.cachedValueIndex = 0;
    next.cachedValueSeconds = Number.NaN;
    return next;
  }

  /** Iterate the events active at `seconds`, in start order. */
  *entries(seconds: number): Generator<TimedEvent<T>> {
    for (let index = 0; index < this.sources.length && this.starts[index] <= seconds; index++) {
      if (this.ends[index] >= seconds) {
        yield { event: this.sources[index], start: this.starts[index], end: this.ends[index] };
      }
    }
  }
  /** Every source event paired with its resolved start and end seconds. */
  get events(): TimedEvent<T>[] {
    return this.sources.map((event, index) => ({
      event,
      start: this.starts[index],
      end: this.ends[index],
    }));
  }
  /** Return the value everywhere, or null when the track can vary. */
  constantValue(): number | null {
    if (this.sources.length === 0) {
      const fallback = Number(this.fallback);
      return Number.isFinite(fallback) ? fallback : null;
    }
    if (!this.numericOnly) {
      return null;
    }
    const first = this.startValues[0];
    const second = this.endValues[0];
    if (!Number.isFinite(first) || first !== second || Number(this.fallback) !== first) {
      return null;
    }
    for (let index = 1; index < this.sources.length; index += 1) {
      if (this.startValues[index] !== first || this.endValues[index] !== first) {
        return null;
      }
    }
    return first;
  }
  /** Resolve one already-known event index without repeating the index lookup. */
  private valueAtIndex(seconds: number, index: number): LineEventValue {
    const source = this.sources[index];
    if (this.numericOnly) {
      return this.sampleNumber(seconds, source, index);
    }
    const entry = this.cachedValueEntry ?? {
      event: source,
      start: this.starts[index],
      end: this.ends[index],
    };
    entry.event = source;
    entry.start = this.starts[index];
    entry.end = this.ends[index];
    this.cachedValueEntry = entry;
    return this.sample(entry, seconds);
  }

  /** Sample numeric tracks without constructing the generic timed-event wrapper. */
  sampleNumeric(seconds: number): number {
    if (!this.numericOnly) {
      return Number(this.value(seconds));
    }
    const starts = this.starts;
    const sourceCount = starts.length;
    if (!sourceCount) {
      return Number(this.fallback);
    }
    if (seconds < this.starts[0]) {
      return Number(this.fallback);
    }
    if (sourceCount === 1) {
      return this.sampleNumber(seconds, this.sources[0], 0);
    }
    const ends = this.ends;
    const lastIndex = sourceCount - 1;
    if (seconds >= ends[lastIndex]) {
      return this.normalizedEndValues[lastIndex];
    }
    const cachedIndex = this.cachedValueIndex;
    // `NaN` naturally fails the comparison, so the hot path avoids a separate
    // Number.isFinite call for every geometric channel on every line.
    const cachedSeconds = this.cachedValueSeconds;
    const nextIndex = cachedIndex + 1;
    const cursorHit =
      seconds >= cachedSeconds &&
      cachedIndex < sourceCount &&
      seconds >= starts[cachedIndex] &&
      (nextIndex >= sourceCount || seconds < starts[nextIndex]);
    if (cursorHit) {
      if (eventCursorStatsEnabled) {
        eventCursorHits += 1;
      }
    } else if (eventCursorStatsEnabled) {
      eventCursorMisses += 1;
    }
    const index = cursorHit ? cachedIndex : this.valueIndex(seconds);
    if (this.linearNumeric) {
      const normalizedStart = this.normalizedStartValues[index];
      const normalizedEnd = this.normalizedEndValues[index];
      if (seconds > this.ends[index]) {
        return normalizedEnd;
      }
      if (normalizedStart === normalizedEnd) {
        return normalizedStart;
      }
      const startTime = this.starts[index];
      const progress =
        this.ends[index] <= startTime
          ? 1
          : Math.max(0, Math.min(1, (seconds - startTime) * this.inverseDurations[index]));
      return normalizedStart + (normalizedEnd - normalizedStart) * progress;
    }
    return this.sampleNumber(seconds, this.sources[index], index);
  }

  /** Sample the active event at `seconds`, or the fallback before the first event. */
  value(seconds: number): LineEventValue {
    if (!this.sources.length) {
      return this.fallback;
    }
    // A later-starting event does not contribute before its first beat.
    if (seconds < this.starts[0]) {
      return this.fallback;
    }
    // Once a numeric track has passed its final event, its value is fixed. Avoid
    // walking the playback cursor and re-evaluating easing for tracks whose
    // authored animation already ended before the current preview time.
    if (this.numericOnly && seconds >= this.ends[this.ends.length - 1]) {
      return this.normalizedEndValues[this.normalizedEndValues.length - 1];
    }
    // Reuse the active segment in either playback direction; a seek that crosses a
    // segment boundary is resolved by valueIndex() and primes the cursor there.
    const cachedIndex = this.cachedValueIndex;
    if (
      Number.isFinite(this.cachedValueSeconds) &&
      cachedIndex < this.starts.length &&
      seconds >= this.starts[cachedIndex] &&
      (cachedIndex + 1 >= this.starts.length || seconds < this.starts[cachedIndex + 1])
    ) {
      if (eventCursorStatsEnabled) {
        eventCursorHits += 1;
      }
      return this.valueAtIndex(seconds, cachedIndex);
    }
    if (eventCursorStatsEnabled) {
      eventCursorMisses += 1;
    }
    const index = this.valueIndex(seconds);
    return this.valueAtIndex(seconds, index);
  }

  /** Numeric sampling path using the precomputed easing tables. */
  private sampleNumber(seconds: number, source: T, index: number): number {
    const startTime = this.starts[index];
    const endTime = this.ends[index];
    const normalizedStart = this.normalizedStartValues[index];
    const normalizedEnd = this.normalizedEndValues[index];
    if (seconds > endTime) {
      return normalizedEnd;
    }
    if (normalizedStart === normalizedEnd) {
      return normalizedStart;
    }
    const progress =
      endTime <= startTime
        ? 1
        : Math.max(0, Math.min(1, (seconds - startTime) * this.inverseDurations[index]));
    if (this.linearNumeric) {
      return normalizedStart + (normalizedEnd - normalizedStart) * progress;
    }
    const easingType = this.easingTypes[index] || 1;
    const amount = this.bezierFlags[index]
      ? bezier(progress, source.bezierPoints ?? [])
      : this.linearFlags[index]
        ? progress
        : this.easingRangeValid[index] && Number.isFinite(progress)
          ? easingWithKnownRange(
              progress,
              easingType,
              this.easingLefts[index],
              this.easingRights[index],
              this.easingBases[index],
              this.easingRanges[index],
            )
          : easingWithRange(
              progress,
              easingType,
              this.easingLefts[index],
              this.easingRights[index],
              this.easingBases[index],
              this.easingRanges[index],
            );
    return normalizedStart + (normalizedEnd - normalizedStart) * amount;
  }

  /** Reuse the active event while playback advances in either direction. */
  private valueIndex(seconds: number): number {
    let index: number;
    if (seconds >= this.cachedValueSeconds) {
      index = this.cachedValueIndex;
      // A long main-thread task can make playback jump across thousands of events. Keep
      // the cheap cursor for ordinary frames, but avoid replaying the whole interval with
      // a linear scan after a stall.
      let steps = 0;
      while (index + 1 < this.starts.length && this.starts[index + 1] <= seconds) {
        index += 1;
        steps += 1;
        if (steps >= 32) {
          index = upperBound(this.starts, seconds) - 1;
          break;
        }
      }
    } else if (Number.isFinite(this.cachedValueSeconds)) {
      // Reverse playback and a backward seek can reuse the same cursor. Only fall
      // back to binary search after a large reverse jump; ordinary reverse frames
      // now walk back through event starts instead of searching every track.
      index = Math.min(this.cachedValueIndex, this.starts.length - 1);
      let steps = 0;
      while (index > 0 && this.starts[index] > seconds) {
        index -= 1;
        steps += 1;
        if (steps >= 32) {
          index = upperBound(this.starts, seconds) - 1;
          break;
        }
      }
    } else {
      index = Math.max(0, upperBound(this.starts, seconds) - 1);
    }
    this.cachedValueIndex = index;
    this.cachedValueSeconds = seconds;
    return index;
  }

  /** Sample an arbitrary event entry using the same easing and payload rules as `value`. */
  sample(entry: TimedEvent<T>, seconds: number): LineEventValue {
    const event = this.integerEndpoints
      ? {
          ...entry.event,
          start: channelInteger(Number(entry.event.start)),
          end: channelInteger(Number(entry.event.end)),
        }
      : entry.event;
    if (seconds > entry.end) {
      return event.end;
    }
    if (event.trajectory) {
      return trajectoryEventValue(
        event,
        entry.end <= entry.start
          ? 1
          : Math.max(0, Math.min(1, (seconds - entry.start) / (entry.end - entry.start))),
      );
    }
    if (typeof event.start === "number" && event.start === event.end) {
      return event.start;
    }
    if (Array.isArray(event.start) && Array.isArray(event.end)) {
      const starts = event.start;
      const ends = event.end;
      if (starts.every((value, index) => value === ends[index])) {
        return starts;
      }
    }
    const progress =
      entry.end <= entry.start
        ? 1
        : Math.max(0, Math.min(1, (seconds - entry.start) / (entry.end - entry.start)));
    const amount = event.bezier
      ? bezier(progress, event.bezierPoints ?? [])
      : easing(progress, event.easingType ?? 1, event.easingLeft ?? 0, event.easingRight ?? 1);
    if (Array.isArray(event.start) && Array.isArray(event.end)) {
      const starts = event.start;
      const ends = event.end;
      return starts.map((value, index) => value + (ends[index] - value) * amount);
    }
    if (typeof event.start === "string" && typeof event.end === "string") {
      const startText = event.start;
      const endText = event.end;
      if (seconds < entry.start) {
        return "";
      }
      if (seconds >= entry.end) {
        return endText.replaceAll("%P%", "");
      }
      if (startText.includes("%P%") && endText.includes("%P%")) {
        const start = Number.parseFloat(startText.replaceAll("%P%", ""));
        const end = Number.parseFloat(endText.replaceAll("%P%", ""));
        if (Number.isFinite(start) && Number.isFinite(end)) {
          const value = start + (end - start) * amount;
          return Number.isInteger(start) && Number.isInteger(end)
            ? String(Math.trunc(value))
            : value.toFixed(3);
        }
      }
      if (endText.startsWith(startText)) {
        return (
          startText +
          [...endText.slice(startText.length)]
            .slice(0, Math.floor([...endText.slice(startText.length)].length * amount))
            .join("")
        );
      }
      if (startText.startsWith(endText)) {
        return (
          endText +
          [...startText.slice(endText.length)]
            .slice(0, Math.floor([...startText.slice(endText.length)].length * (1 - amount)))
            .join("")
        );
      }
      return startText;
    }
    if (typeof event.start !== "number" || typeof event.end !== "number") {
      return event.start;
    }
    return event.start + (event.end - event.start) * amount;
  }
}

/** Integrate speed events into floor-position distance. */
export class SpeedIntegral<T extends JudgeLineEvent = JudgeLineEvent> {
  declare sources: T[];
  declare starts: Float64Array;
  declare ends: Float64Array;
  declare inverseDurations: Float64Array;
  declare prefixes: Float64Array;
  declare prefixEnds: Float64Array;
  declare startValues: Float64Array;
  declare endValues: Float64Array;
  declare easingTypes: Int16Array;
  declare easingLefts: Float64Array;
  declare easingRights: Float64Array;
  declare overlapping: boolean;
  declare maxEnds: Float64Array;
  /** Constant speed value, or null when the layer changes over time. */
  declare constantSpeed: number | null;
  /** True when every valid speed event is a constant step over its time span. */
  declare stepSpeed: boolean;
  private readonly zero: number;
  private cachedValueIndex = 0;
  private cachedValueSeconds = Number.NaN;
  private cachedRawIndex = 0;
  private cachedRawSeconds = Number.NaN;
  private cachedActiveIndex = 0;
  private cachedActiveSeconds = Number.NaN;
  private cachedValueEntry: IntegralEntry<T> | null = null;
  /** Cached linear segment for non-overlapping step-speed playback. */
  private stepSeconds = Number.NaN;
  private stepValue = 0;
  private stepNext = Number.NEGATIVE_INFINITY;
  private stepRate = 0;

  /** Compile speed events and their distance prefixes for repeated sampling. */
  constructor(events: readonly T[] | undefined, tempo: TempoSource, factor = 1) {
    const ordered = (events ?? [])
      .map((event) => ({
        event,
        start: tempo.seconds(event.startTime, factor),
        end: tempo.seconds(event.endTime, factor),
      }))
      .sort((left, right) => left.start - right.start);
    const compacted = compactFlatNumericEvents(ordered);
    this.sources = compacted.map((entry) => entry.event);
    const length = this.sources.length;
    this.starts = new Float64Array(length);
    this.ends = new Float64Array(length);
    this.inverseDurations = new Float64Array(length);
    this.prefixes = new Float64Array(length);
    this.prefixEnds = new Float64Array(length);
    this.startValues = new Float64Array(length);
    this.endValues = new Float64Array(length);
    this.easingTypes = new Int16Array(length);
    this.easingLefts = new Float64Array(length);
    this.easingRights = new Float64Array(length);
    let constantSpeed: number | null = length === 0 ? 0 : Number(this.sources[0]?.start);
    if (!Number.isFinite(constantSpeed)) {
      constantSpeed = null;
    }
    this.overlapping = false;
    let distance = 0;
    let previousTime = 0;
    let previousValue = Number(this.sources[0]?.start ?? 0);
    for (let index = 0; index < length; index++) {
      const timed = compacted[index];
      const event = timed.event;
      const start = timed.start;
      const end = timed.end;
      this.starts[index] = start;
      this.ends[index] = end;
      this.inverseDurations[index] = end > start ? 1 / (end - start) : 0;
      this.startValues[index] = Number(event.start);
      this.endValues[index] = Number(event.end);
      this.easingTypes[index] = event.easingType ?? 1;
      this.easingLefts[index] = event.easingLeft ?? 0;
      this.easingRights[index] = event.easingRight ?? 1;
      if (
        constantSpeed !== null &&
        (Number(event.start) !== constantSpeed || Number(event.end) !== constantSpeed)
      ) {
        constantSpeed = null;
      }
      if (index && start < this.ends[index - 1]) {
        this.overlapping = true;
      }
      distance += Math.max(0, start - previousTime) * previousValue;
      this.prefixes[index] = distance;
      distance += this.integrateEvent(index, 1);
      this.prefixEnds[index] = distance;
      previousTime = end;
      previousValue = Number(event.end);
    }
    this.constantSpeed = constantSpeed;
    this.stepSpeed =
      length > 0 &&
      compacted.every(
        (entry) =>
          entry.end >= entry.start &&
          Number.isFinite(Number(entry.event.start)) &&
          Number(entry.event.start) === Number(entry.event.end),
      );
    this.maxEnds = new Float64Array(length);
    const build = (low: number, high: number): number => {
      if (low >= high) {
        return -Infinity;
      }
      const middle = (low + high) >>> 1;
      return (this.maxEnds[middle] = Math.max(
        this.ends[middle],
        build(low, middle),
        build(middle + 1, high),
      ));
    };
    build(0, length);
    this.zero = this.rawExact(0);
  }
  /** One event with its resolved seconds and distance prefix. */
  entry(index: number): IntegralEntry<T> {
    return {
      event: this.sources[index],
      start: this.starts[index],
      end: this.ends[index],
      prefix: this.prefixes[index],
      prefixEnd: this.prefixEnds[index],
    };
  }
  /** Every speed event with its distance prefix. */
  get events(): IntegralEntry<T>[] {
    return this.sources.map((_, index) => this.entry(index));
  }
  /** Integrate `entry` from its start to `fraction` of its duration. */
  integrate(entry: TimedEvent<T>, fraction: number): number {
    const index = this.sources.indexOf(entry.event);
    return index >= 0 ? this.integrateEvent(index, fraction) : 0;
  }
  /** Integrated speed from an event's start to `fraction` of its duration. */
  private integrateEvent(index: number, fraction: number): number {
    const duration = this.ends[index] - this.starts[index];
    if (duration <= 1e-9) {
      return 0;
    }
    const startValue = this.startValues[index];
    const endValue = this.endValues[index];
    const easingType = this.easingTypes[index];
    const amount = Math.max(0, Math.min(1, fraction));
    if (startValue === endValue) {
      return startValue * amount * duration;
    }
    if (easingType <= 1) {
      return (startValue * amount + ((endValue - startValue) * amount * amount) / 2) * duration;
    }
    const left = this.easingLefts[index];
    const right = this.easingRights[index];
    return (
      (startValue * amount +
        (endValue - startValue) * easingIntegral(amount, easingType, left, right)) *
      duration
    );
  }
  /** Index of the left-most event active at `seconds` within `[low, high)`, or -1. */
  private firstActive(high: number, seconds: number, low = 0): number {
    if (low >= high) {
      return -1;
    }
    const middle = (low + high) >>> 1;
    if (this.maxEnds[middle] < seconds) {
      return -1;
    }
    const left = this.firstActive(middle, seconds, low);
    if (left >= 0) {
      return left;
    }
    if (this.starts[middle] < seconds && this.ends[middle] >= seconds) {
      return middle;
    }
    return this.firstActive(high, seconds, middle + 1);
  }
  /** Reuse the left-most active event during forward playback. */
  private activeIndex(before: number, seconds: number): number {
    let index: number;
    if (Number.isFinite(this.cachedActiveSeconds) && seconds >= this.cachedActiveSeconds) {
      index = Math.max(0, Math.min(this.cachedActiveIndex, before));
      while (index < before && this.ends[index] < seconds) {
        index += 1;
      }
    } else {
      index = this.firstActive(before, seconds);
    }
    this.cachedActiveIndex = index;
    this.cachedActiveSeconds = seconds;
    return index < before && this.starts[index] < seconds && this.ends[index] >= seconds
      ? index
      : -1;
  }
  /** Sample the active speed event's value at `seconds`. */
  value(seconds: number): number {
    if (!this.sources.length) {
      return 0;
    }
    const index = this.valueIndex(seconds);
    const entry = this.cachedValueEntry ?? {
      event: this.sources[index],
      start: this.starts[index],
      end: this.ends[index],
      prefix: this.prefixes[index],
      prefixEnd: this.prefixEnds[index],
    };
    entry.event = this.sources[index];
    entry.start = this.starts[index];
    entry.end = this.ends[index];
    entry.prefix = this.prefixes[index];
    entry.prefixEnd = this.prefixEnds[index];
    this.cachedValueEntry = entry;
    const sampled = EventTrack.prototype.sample.call(this, entry, seconds) as LineEventValue;
    return Number(sampled);
  }

  /** Reuse the active speed event for forward playback sampling. */
  private valueIndex(seconds: number): number {
    let index: number;
    if (Number.isFinite(this.cachedValueSeconds) && seconds >= this.cachedValueSeconds) {
      index = this.cachedValueIndex;
      let steps = 0;
      while (index + 1 < this.starts.length && this.starts[index + 1] < seconds) {
        index += 1;
        steps += 1;
        if (steps >= 32) {
          index = Math.max(0, lowerBound(this.starts, seconds) - 1);
          break;
        }
      }
    } else {
      index = Math.max(0, lowerBound(this.starts, seconds) - 1);
    }
    this.cachedValueIndex = index;
    this.cachedValueSeconds = seconds;
    return index;
  }

  /** Return the first event at or after the sample, preserving lowerBound semantics. */
  private rawIndex(seconds: number): number {
    let index: number;
    if (seconds >= this.cachedRawSeconds) {
      index = this.cachedRawIndex;
      let steps = 0;
      while (index < this.starts.length && this.starts[index] < seconds) {
        index += 1;
        steps += 1;
        if (steps >= 32) {
          index = lowerBound(this.starts, seconds);
          break;
        }
      }
    } else {
      index = lowerBound(this.starts, seconds);
    }
    this.cachedRawIndex = index;
    this.cachedRawSeconds = seconds;
    return index;
  }
  /** Unzeroed distance at `seconds`, including any prefix before the first event. */
  private rawExact(seconds: number): number {
    if (!this.sources.length) {
      return 0;
    }
    if (this.stepSpeed && !this.overlapping) {
      const index = this.rawIndex(seconds);
      if (!index) {
        return Math.max(0, Math.min(seconds, this.starts[0])) * this.startValues[0];
      }
      const previous = index - 1;
      return (
        this.prefixes[previous] +
        Math.max(0, seconds - this.starts[previous]) * this.startValues[previous]
      );
    }
    if (this.overlapping) {
      const before = this.rawIndex(seconds);
      const active = this.activeIndex(before, seconds);
      if (active >= 0) {
        return (
          this.prefixes[active] +
          this.integrateEvent(
            active,
            (seconds - this.starts[active]) * this.inverseDurations[active],
          )
        );
      }
      if (!before) {
        return Math.max(0, Math.min(seconds, this.starts[0])) * this.startValues[0];
      }
      const index = before - 1;
      return (
        this.prefixEnds[index] + Math.max(0, seconds - this.ends[index]) * this.endValues[index]
      );
    }
    const index = this.rawIndex(seconds);
    if (!index) {
      return Math.max(0, Math.min(seconds, this.starts[0])) * this.startValues[0];
    }
    const previous = index - 1;
    return seconds >= this.ends[previous]
      ? this.prefixEnds[previous] + (seconds - this.ends[previous]) * this.endValues[previous]
      : this.prefixes[previous] +
          this.integrateEvent(
            previous,
            (seconds - this.starts[previous]) * this.inverseDurations[previous],
          );
  }
  /** Speed distance at `seconds`, zeroed at chart time zero. */
  raw(seconds: number): number {
    return this.rawExact(seconds) - this.zero;
  }
  /** Floor distance at `seconds` in chart units. */
  distance(seconds: number): number {
    if (this.stepSpeed && !this.overlapping) {
      if (seconds >= this.stepSeconds && seconds < this.stepNext) {
        return this.stepValue + (seconds - this.stepSeconds) * this.stepRate;
      }
      const value = (this.rawExact(seconds) - this.zero) * 120;
      const index = this.rawIndex(seconds);
      const rate =
        index < this.sources.length
          ? this.startValues[index === 0 ? 0 : index - 1]
          : (this.endValues.at(-1) ?? 0);
      this.stepSeconds = seconds;
      this.stepValue = value;
      this.stepNext = index < this.starts.length ? this.starts[index] : Number.POSITIVE_INFINITY;
      this.stepRate = rate * 120;
      return value;
    }
    return this.raw(seconds) * 120;
  }
}
