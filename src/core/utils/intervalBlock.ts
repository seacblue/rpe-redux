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
  /** Build the row-prefix envelopes an expanded query prunes a leading run with. */
  readonly prefixPrune?: boolean;
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
  /**
   * Largest end among rows `0..position`, inclusive.
   *
   * With `prefixMaxExpansions`, this is the conservative reach of every row up
   * to `position`: `end + radius * factor` cannot exceed the pair's combined
   * bound. An expanded query can therefore binary-search the first row that
   * could still reach its lower bound. Empty when the index did not request
   * prefix pruning.
   */
  readonly prefixMaxEnds: Float64Array;
  /** Largest expansion factor among rows `0..position`; empty without pruning. */
  readonly prefixMaxExpansions: Float64Array;
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
  const prefixPrune = source.prefixPrune === true;
  const prefixMaxEnds = new Float64Array(prefixPrune ? length : 0);
  const prefixMaxExpansions = new Float64Array(prefixPrune ? length : 0);
  let maxEnd = -Infinity;
  let maxExpansionFactor = 0;
  let minSecondaryStart = Infinity;
  let maxSecondaryEnd = -Infinity;
  let prefixEnd = -Infinity;
  let prefixExpansion = 0;
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
    if (prefixPrune) {
      if (ends[position] > prefixEnd) {
        prefixEnd = ends[position];
      }
      if (expansion > prefixExpansion) {
        prefixExpansion = expansion;
      }
      prefixMaxEnds[position] = prefixEnd;
      prefixMaxExpansions[position] = prefixExpansion;
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
    prefixMaxEnds,
    prefixMaxExpansions,
    maxEnd,
    maxExpansionFactor,
    minSecondaryStart,
    maxSecondaryEnd,
  };
}

/**
 * First row in `[0, limit)` whose prefix envelope can still reach `start`.
 *
 * The prefix arrays are monotone, so `prefixMaxEnds[i] + radius *
 * prefixMaxExpansions[i]` is monotone in `i`. A row whose own
 * `end + radius * factor` reaches `start` forces that bound to reach `start`
 * at its position, so every qualifying row is at or after the first such
 * index. The two endpoint checks skip the binary search when the whole range
 * already reaches `start` or when no row in range can.
 */
export function firstExpandedRow(
  block: IntervalBlock,
  start: number,
  radius: number,
  limit: number,
): number {
  if (block.prefixMaxEnds.length === 0 || limit <= 0) {
    return 0;
  }
  if (block.prefixMaxEnds[0] + radius * block.prefixMaxExpansions[0] >= start) {
    return 0;
  }
  if (block.prefixMaxEnds[limit - 1] + radius * block.prefixMaxExpansions[limit - 1] < start) {
    return limit;
  }
  let low = 0;
  let high = limit;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (block.prefixMaxEnds[middle] + radius * block.prefixMaxExpansions[middle] < start) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}
