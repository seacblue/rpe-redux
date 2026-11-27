/**
 * Pure Windows-style selection rules for ordered lists.
 *
 * Surfaces keep the selected values in their own domain model, while this
 * module owns the shared click semantics: plain replacement, Ctrl/Cmd toggles,
 * and Shift range replacement from the fixed firstLine item.
 */

/** Pointer modifiers that affect an ordered-list selection. */
export interface ListSelectionModifiers {
  /** Ctrl on Windows/Linux or Cmd on macOS toggles membership. */
  ctrlKey?: boolean;
  /** Shift replaces the selection with a range from the fixed firstLine item. */
  shiftKey?: boolean;
  /** Cmd is accepted as the platform equivalent of Ctrl. */
  metaKey?: boolean;
}

/** The result of applying one pointer selection gesture. */
export interface ListSelectionResult<T> {
  /** Selected values in the order supplied by `items`. */
  selection: T[];
  /** The item that receives focus after the gesture. */
  focus: T;
}

/** Complete selection state shared by every ordered list surface. */
export interface ListSelectionState<T> {
  /** Ordered values currently selected. */
  selection: T[];
  /** Fixed origin for the current Shift range. */
  firstLine: T | null;
  /** Current endpoint of the active Shift range. */
  focus: T | null;
}

/** Create a normalized selection state from a surface snapshot. */
export function createListSelectionState<T>(
  items: readonly T[],
  selection: readonly T[],
  focus: T | null | undefined,
  firstLine: T | null | undefined = focus,
): ListSelectionState<T> {
  const known = new Set(items);
  const ordered = items.filter((value) => known.has(value) && selection.includes(value));
  const fallback = ordered[0] ?? items[0] ?? null;
  const safeFocus = focus !== null && focus !== undefined && known.has(focus) ? focus : fallback;
  const safeFirstLine =
    firstLine !== null && firstLine !== undefined && known.has(firstLine) ? firstLine : safeFocus;
  return { selection: ordered, firstLine: safeFirstLine, focus: safeFocus };
}

/** Apply one click while keeping the Shift range origin and moving focus to the click. */
export function listSelectionStateAfterClick<T>(
  items: readonly T[],
  state: ListSelectionState<T>,
  clicked: T,
  modifiers: ListSelectionModifiers = {},
  preserveNonEmpty = false,
): ListSelectionState<T> {
  const rangeStart = state.firstLine ?? state.focus ?? clicked;
  const result = listSelectionAfterClick(
    items,
    new Set(state.selection),
    rangeStart,
    clicked,
    modifiers,
    preserveNonEmpty,
  );
  return {
    selection: result.selection,
    firstLine: modifiers.shiftKey ? (state.firstLine ?? rangeStart) : clicked,
    focus: result.focus,
  };
}

/** Apply one marquee while publishing its Shift range origin and current focus. */
export function listSelectionStateAfterMarquee<T>(
  items: readonly T[],
  state: ListSelectionState<T>,
  touched: readonly T[],
  modifiers: ListSelectionModifiers = {},
  preserveNonEmpty = false,
): ListSelectionState<T> {
  const result = listSelectionAfterMarquee(
    items,
    new Set(state.selection),
    touched,
    modifiers,
    preserveNonEmpty,
  );
  const touchedSet = new Set(touched);
  const firstTouched = items.find((value) => touchedSet.has(value));
  const firstLine = result.selection[0] ?? state.firstLine ?? state.focus;
  return {
    selection: result.selection,
    firstLine: modifiers.shiftKey ? (firstTouched ?? state.firstLine ?? firstLine) : firstLine,
    focus: modifiers.shiftKey ? (firstTouched ?? result.focus) : (state.focus ?? firstLine),
  };
}

/** Return the contiguous block between two items, including both endpoints. */
export function listSelectionRange<T>(items: readonly T[], from: T, to: T): T[] {
  const start = items.indexOf(from);
  const end = items.indexOf(to);
  if (start < 0 || end < 0) {
    return end < 0 ? [] : [to];
  }
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  return items.slice(low, high + 1);
}

/**
 * Apply one Windows-style click to an ordered list.
 *
 * Shift replaces the selection with the firstLine-to-click range. Ctrl/Cmd toggles
 * only the clicked item. `preserveNonEmpty` keeps editor lists non-empty.
 */
export function listSelectionAfterClick<T>(
  items: readonly T[],
  selected: ReadonlySet<T>,
  rangeFocus: T | null | undefined,
  clicked: T,
  modifiers: ListSelectionModifiers = {},
  preserveNonEmpty = false,
): ListSelectionResult<T> {
  const known = new Set(items);
  if (!known.has(clicked)) {
    const fallback = items[0] ?? clicked;
    return { selection: [...selected], focus: fallback };
  }

  const toggles = Boolean(modifiers.ctrlKey || modifiers.metaKey);
  const extendsRange = Boolean(modifiers.shiftKey);
  const next = new Set<T>();
  if (extendsRange) {
    const rangeStart =
      rangeFocus !== null && rangeFocus !== undefined && known.has(rangeFocus)
        ? rangeFocus
        : clicked;
    for (const value of listSelectionRange(items, rangeStart, clicked)) {
      next.add(value);
    }
  } else if (toggles) {
    for (const value of selected) {
      if (known.has(value)) {
        next.add(value);
      }
    }
    if (next.has(clicked)) {
      next.delete(clicked);
    } else {
      next.add(clicked);
    }
  } else {
    next.add(clicked);
  }

  if (preserveNonEmpty && !next.size) {
    next.add(clicked);
  }
  const ordered = items.filter((value) => next.has(value));
  const focus = next.has(clicked) ? clicked : nearestListValue(items, clicked, ordered);
  return { selection: ordered, focus };
}

/** Return the surviving item closest to an item in list order. */
function nearestListValue<T>(items: readonly T[], target: T, values: readonly T[]): T {
  const targetIndex = Math.max(0, items.indexOf(target));
  let best = values[0] ?? target;
  let distance = Math.abs(items.indexOf(best) - targetIndex);
  for (const value of values) {
    const currentDistance = Math.abs(items.indexOf(value) - targetIndex);
    if (currentDistance < distance) {
      best = value;
      distance = currentDistance;
    }
  }
  return best;
}

/**
 * Resolve one marquee against a captured selection.
 *
 * A plain drag replaces the selection, Shift adds touched rows, and Ctrl/Cmd
 * toggles touched rows against the captured baseline. The result is derived
 * from the baseline every time, so dragging back never accumulates stale hits.
 */
export function listSelectionAfterMarquee<T>(
  items: readonly T[],
  selected: ReadonlySet<T>,
  touched: readonly T[],
  modifiers: ListSelectionModifiers = {},
  preserveNonEmpty = false,
): ListSelectionResult<T> {
  const known = new Set(items);
  const hits = [...new Set(touched)].filter((value) => known.has(value));
  const baseline = new Set([...selected].filter((value) => known.has(value)));
  const toggles = Boolean(modifiers.ctrlKey || modifiers.metaKey);
  const adds = Boolean(modifiers.shiftKey);
  const next = adds || toggles ? new Set(baseline) : new Set<T>();

  if (toggles) {
    for (const value of hits) {
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
    }
  } else {
    for (const value of hits) {
      next.add(value);
    }
  }
  if (preserveNonEmpty && !next.size) {
    const fallback = hits[0] ?? items.find((value) => baseline.has(value));
    if (fallback !== undefined) {
      next.add(fallback);
    }
  }
  const ordered = items.filter((value) => next.has(value));
  const focus = ordered.at(-1) ?? items[0];
  return { selection: ordered, focus: focus as T };
}
