/*
 * Conservative broad-phase directories for chart notes.
 *
 * The directory deliberately knows nothing about rendering. It only decides
 * which notes deserve exact time, cover and position evaluation. When a note's
 * distance model cannot be bounded safely, it is routed through time instead
 * of being guessed into a spatial index.
 */
import { IntervalIndex } from "../../../utils/intervalIndex.ts";
import type { ControlPoint, JudgeLineNote } from "../chart.ts";

/** One distance segment with a certified lower bound for `abs(y)`. */
export interface ControlDistanceEnvelopeSegment {
  start: number;
  end: number;
  minAbsValue: number;
  certified: boolean;
}

/** Conservative envelope for a floor-distance control curve. */
export interface ControlDistanceEnvelope {
  segments: readonly ControlDistanceEnvelopeSegment[];
  /** True only when every segment has a finite, certified lower bound. */
  certified: boolean;
  /** The global certified lower bound, or zero when the proof is unavailable. */
  minAbsValue: number;
}

/**
 * Build a conservative, piecewise lower envelope for a Y control curve.
 *
 * Monotone easing curves are proven to stay between their endpoint values.
 * Overshooting curves are accepted only when both endpoints are identical;
 * otherwise the segment is uncertified and callers must use time fallback.
 */
export function buildControlDistanceEnvelope(
  points: readonly ControlPoint[] | undefined,
): ControlDistanceEnvelope {
  const ordered = [...(points ?? [])].sort((left, right) => (left.x ?? 0) - (right.x ?? 0));
  if (!ordered.length) {
    return {
      segments: [{ start: -Infinity, end: Infinity, minAbsValue: 1, certified: true }],
      certified: true,
      minAbsValue: 1,
    };
  }
  const valueOf = (point: ControlPoint): number =>
    point.y === undefined ? Number.NaN : Number(point.y);
  if (ordered.some((point) => !Number.isFinite(point.x ?? 0) || !Number.isFinite(valueOf(point)))) {
    return {
      segments: [{ start: -Infinity, end: Infinity, minAbsValue: 0, certified: false }],
      certified: false,
      minAbsValue: 0,
    };
  }
  const constantSegment = (value: number, start: number, end: number) => ({
    start,
    end,
    minAbsValue: Number.isFinite(value) ? Math.abs(value) : 0,
    certified: Number.isFinite(value),
  });
  const segments: ControlDistanceEnvelopeSegment[] = [
    constantSegment(valueOf(ordered[0]), -Infinity, ordered[0].x ?? 0),
  ];
  for (let index = 1; index < ordered.length; index++) {
    const start = valueOf(ordered[index - 1]);
    const end = valueOf(ordered[index]);
    const left = ordered[index - 1].x ?? 0;
    const right = ordered[index].x ?? 0;
    const sameValue = start === end && Number.isFinite(start);
    const repeatedPosition = left === right;
    const certified =
      sameValue || (!repeatedPosition && isMonotoneEasing(ordered[index].easing ?? 1));
    const crossesZero = start === 0 || end === 0 || Math.sign(start) !== Math.sign(end);
    segments.push({
      start: left,
      end: right,
      minAbsValue: certified && !crossesZero ? Math.min(Math.abs(start), Math.abs(end)) : 0,
      certified: certified && Number.isFinite(start) && Number.isFinite(end),
    });
  }
  segments.push(
    constantSegment(
      valueOf(ordered[ordered.length - 1]),
      ordered[ordered.length - 1].x ?? 0,
      Infinity,
    ),
  );
  const certified = segments.every((segment) => segment.certified);
  const minAbsValue = certified
    ? segments.reduce((minimum, segment) => Math.min(minimum, segment.minAbsValue), Infinity)
    : 0;
  return {
    segments,
    certified,
    minAbsValue: Number.isFinite(minAbsValue) ? minAbsValue : 0,
  };
}

/** Return whether the built-in easing is guaranteed to stay in `[0, 1]`. */
function isMonotoneEasing(type: number): boolean {
  return (type >= 1 && type <= 19) || type === 22;
}

/** The compiled note fields required by the visibility directories. */
export interface NoteVisibilityEntry {
  noteIndex?: number;
  note: JudgeLineNote;
  start: number;
  end: number;
  floor: number;
  tail: number;
  /** Cumulative line floor at the note start, before `yOffset`. */
  startFloor?: number;
  /** Cumulative line floor at the note end, before `yOffset`. */
  endFloor?: number;
}

/** Supplies a conservative floor expansion for one note. */
export interface NoteVisibilityModel<T extends NoteVisibilityEntry> {
  /**
   * Return floor units per requested screen-radius unit, or `Infinity` when
   * the note must be queried by time because no safe spatial bound is known.
   * The factor is based on the note's constant multiplier only; any line-level
   * speed curve must already be reflected in the sampled floor coordinate.
   */
  floorExpansionFactor(entry: T): number;
  /** True when a certified monotone floor makes active Hold time lookup redundant. */
  holdActivationCoveredBySpatial?: boolean;
}

/** Counts produced by one broad-phase directory query. */
export interface VisibilityDirectoryQueryStats {
  spatialCandidateCount: number;
  temporalCandidateCount: number;
  holdCandidateCount: number;
}

/** Write one query sample into the directory's reusable stats object. */
function writeQueryStats(
  target: VisibilityDirectoryQueryStats,
  spatialCandidateCount: number,
  temporalCandidateCount: number,
  holdCandidateCount: number,
): void {
  target.spatialCandidateCount = spatialCandidateCount;
  target.temporalCandidateCount = temporalCandidateCount;
  target.holdCandidateCount = holdCandidateCount;
}

/**
 * Conservative candidate directory for one judge line.
 *
 * Finite entries use a floor interval expanded independently by their own
 * factor. Unbounded entries use a visible-time interval. Active Holds may also
 * overlap their pre-activation spatial interval, so the query de-duplicates
 * the union before returning it. The caller still performs the exact final
 * visibility rules after receiving these candidates.
 */
export class NoteVisibilityDirectory<T extends NoteVisibilityEntry> {
  declare items: readonly T[];
  declare spatialItems: readonly T[];
  declare temporalItems: readonly T[];
  declare holdItems: readonly T[];
  declare spatialIndex: IntervalIndex<T>;
  declare temporalIndex: IntervalIndex<T>;
  /** Active-time directory for finite-speed Holds whose head is on the line. */
  declare holdActiveIndex: IntervalIndex<T>;
  /** Full visibility-time directory for Holds without a safe spatial bound. */
  declare holdFallbackIndex: IntervalIndex<T>;
  /** Whether each optional time directory has entries worth querying. */
  declare hasTemporalItems: boolean;
  declare hasHoldActiveItems: boolean;
  declare hasHoldFallbackItems: boolean;
  /** True when every candidate is covered by the spatial directory alone. */
  declare spatialOnly: boolean;
  declare temporalQuery: T[];
  declare holdQuery: T[];
  declare holdFallbackQuery: T[];
  declare fallbackQuery: T[];
  /** Reused only when active Holds can overlap another candidate directory. */
  declare seenCandidates: Set<T>;
  declare lastQueryStats: VisibilityDirectoryQueryStats;
  private readonly model: NoteVisibilityModel<T>;

  /** Build conservative floor and time directories for `items`. */
  constructor(items: readonly T[], model: NoteVisibilityModel<T>) {
    this.model = model;
    this.items = items;
    const partition = partitionItems(items, (entry) => this.factor(entry));
    this.spatialItems = partition.spatial;
    this.temporalItems = partition.temporal;
    this.holdItems = partition.holds;
    this.hasTemporalItems = this.temporalItems.length > 0;
    this.hasHoldActiveItems =
      model.holdActivationCoveredBySpatial !== true && this.holdItems.length > 0;
    this.hasHoldFallbackItems = partition.holdFallback.length > 0;
    this.spatialOnly =
      !this.hasTemporalItems && !this.hasHoldActiveItems && !this.hasHoldFallbackItems;
    this.spatialIndex = new IntervalIndex(
      this.spatialItems,
      (entry) => Math.min(entry.floor, entry.tail),
      (entry) => Math.max(entry.floor, entry.tail),
      (entry) => this.factor(entry),
      (entry) => visibilityStart(entry),
      (entry) => entry.end,
    );
    this.temporalIndex = new IntervalIndex(
      this.temporalItems,
      (entry) => visibilityStart(entry),
      (entry) => entry.end,
    );
    this.holdActiveIndex = new IntervalIndex(
      model.holdActivationCoveredBySpatial === true ? [] : this.holdItems,
      (entry) => entry.start,
      (entry) => entry.end,
    );
    this.holdFallbackIndex = new IntervalIndex(
      partition.holdFallback,
      (entry) => visibilityStart(entry),
      (entry) => entry.end,
    );
    this.temporalQuery = [];
    this.holdQuery = [];
    this.holdFallbackQuery = [];
    this.fallbackQuery = [];
    this.seenCandidates = new Set();
    this.lastQueryStats = emptyQueryStats();
  }

  /** Rebuild the compact directories after the source note list changes. */
  replaceItems(items: readonly T[]): void {
    this.items = items;
    const partition = partitionItems(items, (entry) => this.factor(entry));
    this.spatialItems = partition.spatial;
    this.temporalItems = partition.temporal;
    this.holdItems = partition.holds;
    this.hasTemporalItems = this.temporalItems.length > 0;
    this.hasHoldActiveItems =
      this.model.holdActivationCoveredBySpatial !== true && this.holdItems.length > 0;
    this.hasHoldFallbackItems = partition.holdFallback.length > 0;
    this.spatialOnly =
      !this.hasTemporalItems && !this.hasHoldActiveItems && !this.hasHoldFallbackItems;
    this.spatialIndex.replaceItems(this.spatialItems);
    this.temporalIndex.replaceItems(this.temporalItems);
    this.holdActiveIndex.replaceItems(
      this.model.holdActivationCoveredBySpatial === true ? [] : this.holdItems,
    );
    this.holdFallbackIndex.replaceItems(partition.holdFallback);
  }

  /**
   * Return a conservative union of spatial and temporal candidates.
   *
   * `floor` is the exact sampled line floor. The spatial query is only a
   * broad phase; callers must not use it as the final note-distance result.
   */
  query(seconds: number, floor: number, radius: number, result: T[]): T[] {
    result.length = 0;
    this.spatialIndex.queryItemsExpandedAndSecondaryInto(
      floor,
      floor,
      radius,
      seconds,
      seconds,
      result,
    );
    const spatialCandidateCount = result.length;
    if (this.spatialOnly) {
      writeQueryStats(this.lastQueryStats, spatialCandidateCount, 0, 0);
      return result;
    }
    if (this.hasTemporalItems) {
      this.temporalIndex.queryItemsInto(seconds, seconds, this.temporalQuery);
    } else {
      this.temporalQuery.length = 0;
    }
    if (this.hasHoldActiveItems) {
      this.holdActiveIndex.queryItemsInto(seconds, seconds, this.holdQuery);
    } else {
      this.holdQuery.length = 0;
    }
    if (this.hasHoldFallbackItems) {
      this.holdFallbackIndex.queryItemsInto(seconds, seconds, this.holdFallbackQuery);
    } else {
      this.holdFallbackQuery.length = 0;
    }

    const temporalCandidateCount = this.temporalQuery.length;
    const holdCandidateCount = this.holdQuery.length + this.holdFallbackQuery.length;
    const hasFallback = temporalCandidateCount > 0 || holdCandidateCount > 0;
    if (!hasFallback) {
      this.fallbackQuery.length = 0;
      writeQueryStats(this.lastQueryStats, spatialCandidateCount, 0, 0);
      return result;
    }

    this.fallbackQuery.length = 0;
    this.fallbackQuery.push(...this.temporalQuery, ...this.holdQuery, ...this.holdFallbackQuery);
    if (this.fallbackQuery.length > 1) {
      this.fallbackQuery.sort((left, right) => (left.noteIndex ?? 0) - (right.noteIndex ?? 0));
    }

    // Temporal entries and unbounded Holds are disjoint from the spatial
    // directory. Only finite-speed active Holds can overlap it, so most
    // fallback queries can append without paying for a candidate set.
    let hasSpatialHold = false;
    if (this.holdQuery.length > 0) {
      for (const entry of result) {
        if (entry.note.type === 2) {
          hasSpatialHold = true;
          break;
        }
      }
    }
    const needsDedup = this.holdQuery.length > 0 && hasSpatialHold;
    if (!needsDedup) {
      result.push(...this.fallbackQuery);
      writeQueryStats(
        this.lastQueryStats,
        spatialCandidateCount,
        temporalCandidateCount,
        holdCandidateCount,
      );
      return result;
    }

    this.seenCandidates.clear();
    for (const entry of result) {
      this.seenCandidates.add(entry);
    }
    let appendedTemporalCandidateCount = 0;
    let appendedHoldCandidateCount = 0;
    for (const entry of this.fallbackQuery) {
      if (this.seenCandidates.has(entry)) {
        continue;
      }
      this.seenCandidates.add(entry);
      result.push(entry);
      if (entry.note.type === 2) {
        appendedHoldCandidateCount++;
      } else {
        appendedTemporalCandidateCount++;
      }
    }
    this.seenCandidates.clear();
    writeQueryStats(
      this.lastQueryStats,
      spatialCandidateCount,
      appendedTemporalCandidateCount,
      appendedHoldCandidateCount,
    );
    return result;
  }

  /** Resolve a model factor once so one query cannot disagree with its block envelope. */
  private factor(entry: T): number {
    const factor = this.model.floorExpansionFactor(entry);
    return Number.isFinite(factor) && factor >= 0 ? factor : Number.POSITIVE_INFINITY;
  }
}

/** Create a zeroed query sample for a newly compiled directory. */
function emptyQueryStats(): VisibilityDirectoryQueryStats {
  return {
    spatialCandidateCount: 0,
    temporalCandidateCount: 0,
    holdCandidateCount: 0,
  };
}

/** Return the earliest safe time at which an entry may become visible. */
function visibilityStart<T extends NoteVisibilityEntry>(entry: T): number {
  const visibleTime = entry.note.visibleTime;
  if (visibleTime === undefined) {
    return entry.start - 999999;
  }
  if (!Number.isFinite(visibleTime)) {
    return -Number.MAX_VALUE;
  }
  return entry.start - visibleTime;
}

/** Partition entries once so the model is never evaluated twice for one entry. */
function partitionItems<T extends NoteVisibilityEntry>(
  items: readonly T[],
  factorOf: (entry: T) => number,
): { spatial: T[]; temporal: T[]; holds: T[]; holdFallback: T[] } {
  const spatial: T[] = [];
  const temporal: T[] = [];
  const holds: T[] = [];
  const holdFallback: T[] = [];
  for (const entry of items) {
    const factor = factorOf(entry);
    if (entry.note.type === 2) {
      if (!Number.isFinite(factor)) {
        holdFallback.push(entry);
      } else {
        holds.push(entry);
        spatial.push(entry);
      }
    } else if (Number.isFinite(factor)) {
      spatial.push(entry);
    } else {
      temporal.push(entry);
    }
  }
  return { spatial, temporal, holds, holdFallback };
}
