/**
 * Groups line-selector entries by folder, keeping folders that hold no lines.
 *
 * The toolbar picker and the multi-line line list both derive folder rows from
 * line entries alone, which hides a folder created before its first line. This
 * helper merges the published folder list into that grouping so both surfaces
 * show every folder in chart order.
 */

/** One folder row, its declared index, and the line entries it owns. */
export interface LineGroupEntries<T> {
  /** Position in the folder list; the token field stores this as the folder key. */
  index: number;
  name: string;
  entries: T[];
}

/**
 * Build folder rows from the declared folder names plus the line entries.
 *
 * Declared folders keep their order and appear even when empty. A line whose
 * folder name is not declared yet is appended after the declared folders rather
 * than dropped, so stale published data never hides a row.
 */
export function groupLineEntries<T extends { group: string }>(
  entries: readonly T[],
  names: readonly string[],
): LineGroupEntries<T>[] {
  const buckets = new Map<string, T[]>();
  for (const name of names) {
    if (!buckets.has(name)) {
      buckets.set(name, []);
    }
  }
  for (const entry of entries) {
    const bucket = buckets.get(entry.group);
    if (bucket) {
      bucket.push(entry);
    } else {
      buckets.set(entry.group, [entry]);
    }
  }
  return [...buckets].map(([name, groupEntries], index) => ({
    index,
    name,
    entries: groupEntries,
  }));
}
