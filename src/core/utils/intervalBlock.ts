/**
 * One block of an `IntervalIndex`: the rows it owns plus the envelopes a query tests.
 *
 * A block exists so a range query can reject a whole group of intervals from a few numbers
 * instead of touching each one. The envelope is computed once when the block is built, and
 * every per-row value a query needs — the expansion factor and the secondary range — is
 * stored here as well, so the query loop reads contiguous arrays rather than calling an
 * accessor per row.
 *
 * The secondary range is optional: a caller that indexes one span passes no accessors and
 * pays nothing for it.
 */

/** The item accessors a block reads once, when it is built. */
export interface IntervalBlockSource<T> {
  /** Source items, addressed by the stored indices. */
  readonly items: readonly T[];
  /** How far this item grows when a query widens its range. */
  readonly expansionFactor: (item: T) => number;
  /** Start of the optional secondary span a query may also filter on. */
  readonly secondaryStart?: (item: T) => number;
  /** End of the optional secondary span a query may also filter on. */
  readonly secondaryEnd?: (item: T) => number;
}

/** A group of intervals with the bounds a range query rejects it by. */
export interface IntervalBlock {
  /** Source indices, ascending, one per row. */
  readonly indices: Uint32Array;
  /** Row start values, parallel to `indices`. */
  readonly starts: Float64Array;
  /** Row end values, parallel to `indices`. */
  readonly ends: Float64Array;
  /** Per-row expansion factor, so a query does not call an accessor per row. */
  readonly expansions: Float64Array;
  /** Per-row secondary start, parallel to `indices`; empty without a secondary accessor. */
  readonly secondaryStarts: Float64Array;
  /** Per-row secondary end, parallel to `indices`; empty without a secondary accessor. */
  readonly secondaryEnds: Float64Array;
  /** Largest end in the block. */
  readonly maxEnd: number;
  /** Largest expansion factor in the block. */
  readonly maxExpansionFactor: number;
  /** Smallest secondary start, or `Infinity` when no secondary accessor was given. */
  readonly minSecondaryStart: number;
  /** Largest secondary end, or `-Infinity` when no secondary accessor was given. */
  readonly maxSecondaryEnd: number;
}

/**
 * Build one block and compute every envelope a query tests.
 *
 * `expansions` is the reason this module exists: the query path multiplies a radius by each
 * row's factor, and reading it from a `Float64Array` beside the other row data keeps that
 * loop over contiguous memory instead of following a callback into the source item.
 */
export function createIntervalBlock<T>(
  source: IntervalBlockSource<T>,
  indices: Uint32Array,
  starts: Float64Array,
  ends: Float64Array,
): IntervalBlock {
  const length = indices.length;
  const expansions = new Float64Array(length);
  let maxEnd = -Infinity;
  let maxExpansionFactor = 0;
  let minSecondaryStart = Infinity;
  let maxSecondaryEnd = -Infinity;
  const hasSecondary = source.secondaryStart !== undefined && source.secondaryEnd !== undefined;
  const secondaryStarts = new Float64Array(hasSecondary ? length : 0);
  const secondaryEnds = new Float64Array(hasSecondary ? length : 0);
  for (let position = 0; position < length; position += 1) {
    const item = source.items[indices[position]];
    const expansion = source.expansionFactor(item);
    expansions[position] = expansion;
    if (expansion > maxExpansionFactor) {
      maxExpansionFactor = expansion;
    }
    if (ends[position] > maxEnd) {
      maxEnd = ends[position];
    }
    if (hasSecondary) {
      const secondaryStart = source.secondaryStart?.(item) ?? 0;
      const secondaryEnd = source.secondaryEnd?.(item) ?? 0;
      secondaryStarts[position] = secondaryStart;
      secondaryEnds[position] = secondaryEnd;
      if (secondaryStart < minSecondaryStart) {
        minSecondaryStart = secondaryStart;
      }
      if (secondaryEnd > maxSecondaryEnd) {
        maxSecondaryEnd = secondaryEnd;
      }
    }
  }
  return {
    indices,
    starts,
    ends,
    expansions,
    secondaryStarts,
    secondaryEnds,
    maxEnd,
    maxExpansionFactor,
    minSecondaryStart,
    maxSecondaryEnd,
  };
}
