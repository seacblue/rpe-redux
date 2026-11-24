/**
 * Stable ordering for discovered note-skin packages.
 *
 * Built-in order is owned by the bundled package registry. Discovered skins
 * use their persisted insertion timestamp, while legacy entries without one
 * remain after timestamped packages in their original scan order.
 */

/** A package value that carries its persisted insertion time. */
export interface AddedNoteSkin {
  readonly addedAt: number;
}

/** Return packages in insertion order without disturbing equal-time entries. */
export function orderNoteSkins<T extends AddedNoteSkin>(entries: readonly T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftTime = left.entry.addedAt > 0 ? left.entry.addedAt : Number.POSITIVE_INFINITY;
      const rightTime = right.entry.addedAt > 0 ? right.entry.addedAt : Number.POSITIVE_INFINITY;
      return leftTime - rightTime || left.index - right.index;
    })
    .map(({ entry }) => entry);
}
