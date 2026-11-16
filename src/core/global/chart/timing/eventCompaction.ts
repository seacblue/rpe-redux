/** Compacts redundant flat event markers while preserving the event sampling contract. */

/** Event-like entry whose numeric endpoints can be checked during compilation. */
export interface NumericEventEntry {
  event: {
    trajectory?: unknown;
    start?: unknown;
    end?: unknown;
  };
  start: number;
  end: number;
}

/** Remove flat numeric events that cannot change the sampled value. */
export function compactFlatNumericEvents<T extends NumericEventEntry>(ordered: readonly T[]): T[] {
  const compacted: T[] = [];
  for (const entry of ordered) {
    const previous = compacted.at(-1);
    const flat =
      !entry.event.trajectory &&
      typeof entry.event.start === "number" &&
      entry.event.start === entry.event.end;
    const previousNumeric =
      previous !== undefined &&
      !previous.event.trajectory &&
      typeof previous.event.end === "number";
    const repeated =
      flat &&
      previous !== undefined &&
      !previous.event.trajectory &&
      typeof previous.event.start === "number" &&
      previous.event.start === previous.event.end &&
      previous.event.start === entry.event.start;
    const trailingPlateau =
      flat &&
      previousNumeric &&
      previous.event.end === entry.event.start &&
      (previous.event.start === previous.event.end || previous.end <= entry.start);
    if (!repeated && !trailingPlateau) {
      compacted.push(entry);
    }
  }
  return compacted;
}
