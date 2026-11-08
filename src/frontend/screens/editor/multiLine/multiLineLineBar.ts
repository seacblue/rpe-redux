/**
 * Pure model and selection rules shared by multi-line judge-line surfaces.
 *
 * The timeline bar and the inspector's line list read the same
 * `editor.lineOptions`, `editor.lineSelection`, and `editor.line` cells; this
 * module turns that data into compact rows and describes what one click does
 * before a surface writes the shared cells. Keeping the rule here keeps the two
 * surfaces from drifting apart.
 */
import type { EditorLineOption } from "../../../../core/edit/state/publishedValues.ts";

/** One compact line row rendered by a multi-line judge-line surface. */
export interface MultiLineLineBarItem {
  /** Zero-based judge-line index, also the number shown in the row. */
  index: number;
  /** Name without the group prefix; empty names use the localized fallback. */
  name: string;
  /** Localized group name, or an empty string for the unnamed first group. */
  group: string;
  /** True for the line the timeline is editing. */
  current: boolean;
  /** True while the line belongs to the multi-line selection. */
  selected: boolean;
}

/** A click result ready to be written to `editor.line` and `editor.lineSelection`. */
export interface MultiLineLineBarState {
  current: number;
  selection: number[];
}

/** Remove duplicates and order line indices ascending. */
function sortedUnique(indices: readonly number[]): number[] {
  return [...new Set(indices.filter((index) => Number.isInteger(index) && index >= 0))].sort(
    (left, right) => left - right,
  );
}

/** Pick the remaining line nearest a removed one, keeping the current line when possible. */
function focusAfterRemoval(next: readonly number[], removed: number, current: number): number {
  if (removed !== current && next.includes(current)) {
    return current;
  }
  let best = next[0] ?? current;
  let bestDistance = Infinity;
  for (const index of next) {
    const distance = Math.abs(index - removed);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Build the displayed rows from the shared toolbar line options.
 *
 * `lineDisplayName` already prefixes the group name, so the row removes that
 * prefix and draws the group in its own column. The fallback is defensive: the
 * shared options currently resolve unnamed lines before they reach a surface.
 */
export function buildMultiLineLineBarItems(
  options: readonly EditorLineOption[],
  selection: readonly number[],
  current: number,
  fallbackName: (index: number) => string,
): MultiLineLineBarItem[] {
  const selected = new Set(selection);
  return options.map((option) => {
    const rawName = option.name.trim();
    const groupPrefix = option.group ? `${option.group}.` : "";
    const withoutGroup =
      groupPrefix && rawName.startsWith(groupPrefix)
        ? rawName.slice(groupPrefix.length).trim()
        : rawName;
    return {
      index: option.index,
      name: withoutGroup || fallbackName(option.index),
      group: option.group,
      current: option.index === current,
      selected: selected.has(option.index),
    };
  });
}

/**
 * Resolve one click on a line row using the toolbar contract.
 *
 * A plain click replaces the selection with the clicked line. Shift-click
 * toggles only the clicked line. The selection never becomes empty, and a
 * removal keeps the current line inside the remaining selection when it can.
 */
export function lineBarSelectionAfterClick(
  current: number,
  selection: readonly number[],
  clicked: number,
  toggle: boolean,
): MultiLineLineBarState {
  const base = sortedUnique(selection);
  const focus = Number.isInteger(current) && current >= 0 ? current : clicked;
  if (!Number.isInteger(clicked) || clicked < 0) {
    return { current: focus, selection: base };
  }
  if (!toggle) {
    return { current: clicked, selection: [clicked] };
  }
  if (base.includes(clicked)) {
    if (base.length <= 1) {
      return { current: clicked, selection: base };
    }
    const next = base.filter((index) => index !== clicked);
    return { current: focusAfterRemoval(next, clicked, focus), selection: next };
  }
  return { current: clicked, selection: sortedUnique([...base, clicked]) };
}

/**
 * Return the scroll offset that brings one row fully into a horizontal viewport.
 *
 * An unchanged offset means the row is already visible. `edgePadding` keeps a
 * small gutter between the row and the viewport edge; a row wider than the
 * viewport aligns to its left edge.
 */
export function lineBarScrollLeft(
  scrollLeft: number,
  viewportWidth: number,
  itemLeft: number,
  itemRight: number,
  edgePadding = 0,
): number {
  const left = Math.max(0, itemLeft - edgePadding);
  const right = itemRight + edgePadding;
  if (itemRight - itemLeft > viewportWidth) {
    return left;
  }
  if (left < scrollLeft) {
    return left;
  }
  if (right > scrollLeft + viewportWidth) {
    return Math.max(0, right - viewportWidth);
  }
  return scrollLeft;
}
