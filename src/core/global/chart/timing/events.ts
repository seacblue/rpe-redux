/**
 * Event tracks and the speed integral used by the scene runtime.
 *
 * `EventTrack` compiles timed judge-line events into typed-array lookup tables and
 * samples them at a chart time; `SpeedIntegral` accumulates a distance prefix for
 * speed events. Beat-to-second conversion arrives through `TempoSource`.
 */
import { channelInteger } from "../chart.ts";
import { lowerBound, upperBound } from "../../../utils/search.ts";
import {
  bezier,
  easing,
  easingIntegral,
  easingParameters,
  easingWithRange,
} from "../../../utils/easing.ts";
import { trajectoryEventValue } from "../trajectory/curveTrajectory.ts";
import type { JudgeLineEvent, LineEventValue } from "../chart.ts";
import { isOrderedBeatRange } from "./beat.ts";

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

/** A compiled event track sampled at chart time in seconds. */
export class EventTrack<T extends JudgeLineEvent = JudgeLineEvent> {
  declare fallback: LineEventValue;
  declare integerEndpoints: boolean;
  declare sources: T[];
  declare starts: Float64Array;
  declare ends: Float64Array;
  declare inverseDurations: Float64Array;
  declare startValues: Float64Array;
  declare endValues: Float64Array;
  declare easingTypes: Int16Array;
  declare easingLefts: Float64Array;
  declare easingRights: Float64Array;
  declare easingBases: Float64Array;
  declare easingRanges: Float64Array;
  declare bezierFlags: Uint8Array;
  declare linearFlags: Uint8Array;
  declare numericOnly: boolean;
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
    this.sources = ordered.map((entry) => entry.event);
    this.starts = Float64Array.from(ordered, (entry) => entry.start);
    this.ends = Float64Array.from(ordered, (entry) => entry.end);
    this.inverseDurations = Float64Array.from(ordered, (entry) =>
      entry.end > entry.start ? 1 / (entry.end - entry.start) : 0,
    );
    this.startValues = Float64Array.from(ordered, (entry) => Number(entry.event.start));
    this.endValues = Float64Array.from(ordered, (entry) => Number(entry.event.end));
    this.easingTypes = Int16Array.from(ordered, (entry) => entry.event.easingType ?? 1);
    this.easingLefts = Float64Array.from(ordered, (entry) => entry.event.easingLeft ?? 0);
    this.easingRights = Float64Array.from(ordered, (entry) => entry.event.easingRight ?? 1);
    this.bezierFlags = Uint8Array.from(ordered, (entry) => (entry.event.bezier ? 1 : 0));
    this.numericOnly = ordered.every(
      (entry) =>
        !entry.event.trajectory &&
        typeof entry.event.start === "number" &&
        typeof entry.event.end === "number",
    );
    this.easingBases = Float64Array.from(ordered, (entry) => {
      const event = entry.event;
      return easingParameters(event.easingType ?? 1, event.easingLeft ?? 0, event.easingRight ?? 1)
        .base;
    });
    this.easingRanges = Float64Array.from(ordered, (entry, index) => {
      const event = entry.event;
      return easingParameters(event.easingType ?? 1, event.easingLeft ?? 0, event.easingRight ?? 1)
        .range;
    });
    this.linearFlags = Uint8Array.from(ordered, (entry) =>
      (entry.event.easingType ?? 1) === 1 &&
      (entry.event.easingLeft ?? 0) !== (entry.event.easingRight ?? 1)
        ? 1
        : 0,
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
        next.sources = [...sources];
        next.starts = Float64Array.from(indices, (index) => this.starts[index]);
        next.ends = Float64Array.from(indices, (index) => this.ends[index]);
        next.inverseDurations = Float64Array.from(indices, (index) => this.inverseDurations[index]);
        next.startValues = Float64Array.from(indices, (index) => this.startValues[index]);
        next.endValues = Float64Array.from(indices, (index) => this.endValues[index]);
        next.easingTypes = Int16Array.from(indices, (index) => this.easingTypes[index]);
        next.easingLefts = Float64Array.from(indices, (index) => this.easingLefts[index]);
        next.easingRights = Float64Array.from(indices, (index) => this.easingRights[index]);
        next.easingBases = Float64Array.from(indices, (index) => this.easingBases[index]);
        next.easingRanges = Float64Array.from(indices, (index) => this.easingRanges[index]);
        next.bezierFlags = Uint8Array.from(indices, (index) => this.bezierFlags[index]);
        next.linearFlags = Uint8Array.from(indices, (index) => this.linearFlags[index]);
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
  /**
   * The value this track returns everywhere, or null when it can vary.
   *
   * Exported RPE charts write a flat event on every track: a real chart carries one
   * `inclineEvents` entry per line with `start:0 end:0`, which cannot incline anything but
   * still puts the line on the slow sample path. Reporting the flat value lets a caller
   * treat the track as absent, while a track that is flat at a non-neutral value stays
   * distinguishable instead of being silently dropped.
   */
  constantValue(): number | null {
    if (this.sources.length === 0) {
      return Number(this.fallback);
    }
    const first = this.startValues[0];
    const second = this.endValues[0];
    if (!Number.isFinite(first) || first !== second) {
      return null;
    }
    for (let index = 1; index < this.sources.length; index += 1) {
      if (this.startValues[index] !== first || this.endValues[index] !== first) {
        return null;
      }
    }
    return first;
  }

  /** Sample the active event at `seconds`, or the fallback before the first event. */
  value(seconds: number): LineEventValue {
    if (!this.sources.length) {
      return this.fallback;
    }
    // RPE only reads an event while it is active. A later-starting event does
    // not contribute its start value before its first beat; the channel keeps
    // its default until then.
    if (seconds < this.starts[0]) {
      return this.fallback;
    }
    const index = this.valueIndex(seconds);
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

  /** Numeric sampling path using the precomputed easing tables. */
  private sampleNumber(seconds: number, source: T, index: number): number {
    const start = this.startValues[index];
    const end = this.endValues[index];
    const startTime = this.starts[index];
    const endTime = this.ends[index];
    const normalizedStart = this.integerEndpoints ? channelInteger(start) : start;
    const normalizedEnd = this.integerEndpoints ? channelInteger(end) : end;
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
    const easingType = this.easingTypes[index] || 1;
    const amount = this.bezierFlags[index]
      ? bezier(progress, source.bezierPoints ?? [])
      : this.linearFlags[index]
        ? progress
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

  /** Reuse the active event while playback advances; seeks and reverse playback re-search. */
  private valueIndex(seconds: number): number {
    let index: number;
    if (seconds >= this.cachedValueSeconds) {
      index = this.cachedValueIndex;
      // An event starting exactly at `seconds` owns the sample.
      while (index + 1 < this.starts.length && this.starts[index + 1] <= seconds) {
        index += 1;
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

/**
 * Speed events integrate to a floor-position distance.
 *
 * The easing curve describes the speed value itself; integrating it over the
 * event duration gives the height travelled.
 */
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
  private readonly zero: number;
  private cachedValueIndex = 0;
  private cachedValueSeconds = Number.NaN;
  private cachedRawIndex = 0;
  private cachedRawSeconds = Number.NaN;
  private cachedActiveIndex = 0;
  private cachedActiveSeconds = Number.NaN;
  private cachedValueEntry: IntegralEntry<T> | null = null;

  /** Compile speed events and their distance prefixes for repeated sampling. */
  constructor(events: readonly T[] | undefined, tempo: TempoSource, factor = 1) {
    const ordered = (events ?? [])
      .map((event) => ({
        event,
        start: tempo.seconds(event.startTime, factor),
        end: tempo.seconds(event.endTime, factor),
      }))
      .sort((left, right) => left.start - right.start);
    this.sources = ordered.map((entry) => entry.event);
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
    this.overlapping = false;
    let distance = 0;
    let previousTime = 0;
    let previousValue = Number(this.sources[0]?.start ?? 0);
    for (let index = 0; index < length; index++) {
      const timed = ordered[index];
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
  /**
   * Reuse the left-most active event during forward playback; seeks and reverse
   * playback fall back to the bounded search.
   */
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
      while (index + 1 < this.starts.length && this.starts[index + 1] < seconds) {
        index += 1;
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
      while (index < this.starts.length && this.starts[index] < seconds) {
        index += 1;
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
    return this.raw(seconds) * 120;
  }
}
