// Toolbar overflow measurement: one pure rule drives narrow-state rendering and edge controls.

const OVERFLOW_EPSILON = 1;

/** A measured horizontal range belonging to one toolbar row. */
export interface ToolbarRowOverflowMeasurement {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

/** The dimensions needed to determine whether the toolbar has entered narrow mode. */
export interface ToolbarOverflowMeasurement {
  toolbarWidth: number;
  toolbarScrollWidth: number;
  rows: readonly ToolbarRowOverflowMeasurement[];
}

/** The visible overflow state used by the toolbar frame and its scroll controls. */
export interface ToolbarOverflowState {
  isNarrow: boolean;
  canScrollStart: boolean;
  canScrollEnd: boolean;
}

/** A row's natural content width and visible viewport used for shared scrolling. */
export interface SharedScrollRowMeasurement {
  clientWidth: number;
  contentWidth: number;
}

/**
 * Calculates the invisible trailing space needed to give every row one scroll range.
 *
 * A row that is shorter than the viewport has a negative range, and it needs more
 * padding than a row that merely scrolls less: the padding has to close its own
 * deficit *and* match the longest row's range. Clamping that deficit to zero first
 * would leave such a row unable to scroll at all, which is what made a short second
 * row sit still while the first one moved.
 */
export function calculateSharedScrollCompensation(
  rows: readonly SharedScrollRowMeasurement[],
): number[] {
  const ranges = rows.map((row) => row.contentWidth - row.clientWidth);
  const sharedMaxScroll = Math.max(0, ...ranges);
  return ranges.map((range) => Math.max(0, sharedMaxScroll - range));
}

/** Calculates narrow mode and scroll affordances from measured layout dimensions. */
export function calculateToolbarOverflowState(
  measurement: ToolbarOverflowMeasurement,
): ToolbarOverflowState {
  const { toolbarWidth, toolbarScrollWidth, rows } = measurement;
  const canScrollStart = rows.some((row) => row.scrollLeft > OVERFLOW_EPSILON);
  const canScrollEnd = rows.some(
    (row) => row.scrollLeft + row.clientWidth < row.scrollWidth - OVERFLOW_EPSILON,
  );
  const isNarrow =
    toolbarScrollWidth > toolbarWidth + OVERFLOW_EPSILON || canScrollStart || canScrollEnd;
  return { isNarrow, canScrollStart, canScrollEnd };
}

/** Reads toolbar and row dimensions from the mounted toolbar surface. */
export function readToolbarOverflowState(root: HTMLElement): ToolbarOverflowState {
  const rows = Array.from(root.querySelectorAll<HTMLElement>(".redux-toolbar-line"));
  return calculateToolbarOverflowState({
    toolbarWidth: root.clientWidth,
    toolbarScrollWidth: root.scrollWidth,
    rows: rows.map((row) => ({
      scrollLeft: row.scrollLeft,
      clientWidth: row.clientWidth,
      scrollWidth: row.scrollWidth,
    })),
  });
}
