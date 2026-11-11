/**
 * Keeps recently removed list items in the render tree for one exit transition.
 *
 * A list that disappears on a store update cannot animate its own removal: the
 * item is gone before CSS can run. This hook returns the current items plus the
 * removed ones, and marks the removed keys as `leaving`, until the exit duration
 * elapses. The first render after the removal already includes the removed item,
 * so the exit never flashes the list without it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Items to render, plus the keys that are currently playing their exit. */
export interface PresenceList<T> {
  items: readonly T[];
  leaving: ReadonlySet<string>;
}

/**
 * Track removals from `items`.
 *
 * `keyOf` must return a stable key and should be defined at module scope so the
 * effect does not see a new identity on every render. `duration` matches the
 * exit transition declared for the item's own CSS class.
 */
export function usePresenceList<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  duration = 160,
): PresenceList<T> {
  const [leaving, setLeaving] = useState<readonly T[]>([]);
  const previous = useRef(items);
  const timer = useRef<number | undefined>(undefined);
  const keyOfRef = useRef(keyOf);
  keyOfRef.current = keyOf;

  const currentKeys = new Set(items.map((item) => keyOfRef.current(item)));
  const fresh = previous.current.filter((item) => !currentKeys.has(keyOfRef.current(item)));
  const known = new Set(leaving.map((item) => keyOfRef.current(item)));
  const allLeaving = [...leaving, ...fresh.filter((item) => !known.has(keyOfRef.current(item)))];
  const visible = [
    ...items,
    ...allLeaving.filter((item) => !currentKeys.has(keyOfRef.current(item))),
  ];
  const leavingKeys = new Set(
    visible
      .filter((item) => !currentKeys.has(keyOfRef.current(item)))
      .map((item) => keyOfRef.current(item)),
  );

  useLayoutEffect(() => {
    previous.current = items;
    if (!fresh.length) {
      return;
    }
    setLeaving(allLeaving);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLeaving([]), duration);
    // `fresh` and `allLeaving` are derived from the render that observed the
    // removal; the effect only commits that observation.
  }, [items, duration]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { items: visible, leaving: leavingKeys };
}
