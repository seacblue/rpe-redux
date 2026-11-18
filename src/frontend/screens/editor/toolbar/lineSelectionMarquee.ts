/**
 * Shift-drag preview rules for the toolbar judge-line picker.
 *
 * A drag only computes a candidate selection; the committed selection stays
 * untouched until release. The picker owns pointer tracking, auto-scroll, and
 * the rendered rectangle, then passes the rows under the pointer here. This
 * module also owns the content-coordinate conversion so the rectangle and the
 * row hit test share one origin: the scrolling list's padding box, not its
 * border box.
 */

/** Direction painted by a Shift drag. */
export type MarqueeMode = "add" | "remove";

/** One point in the scrolling list's content coordinates. */
export interface MarqueePoint {
  x: number;
  y: number;
}

/** The pointer rectangle in content coordinates. */
export interface MarqueeBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Candidate selection and focus produced while dragging. */
export interface MarqueePreview {
  /** Candidate line indices; never empty when the committed set is non-empty. */
  selection: ReadonlySet<number>;
  /** Candidate current line; a member of `selection`. */
  focus: number;
  /** Whether the drag paints rows in or out. */
  mode: MarqueeMode;
  /** Rows the drag touches, in commit order; the pressed row leads. */
  lines: readonly number[];
}

/** Receives the final preview exactly once, on release. */
export type MarqueeCommit = (preview: MarqueePreview) => void;

/** A drag that never writes to the committed selection before `finish`. */
export interface MarqueeDrag {
  /** `add` paints rows in, `remove` paints rows out. */
  readonly mode: MarqueeMode;
  /** The row pressed to start the drag. */
  readonly anchor: number;
  /** The latest candidate selection. */
  preview(): MarqueePreview;
  /**
   * Recompute from the rows under the pointer.
   *
   * `forward` says the pointer moved down from the press point, so focus follows
   * the last selected row in the drag direction. Updates are idempotent: each
   * call starts from the committed set, so dragging back shrinks the preview.
   */
  update(rows: readonly number[], forward: boolean): MarqueePreview;
  /** Publish the latest preview through `commit` once. */
  finish(): MarqueePreview;
  /** Drop the preview without committing; a later `finish` is a no-op. */
  cancel(): void;
}

/**
 * Start a Shift drag from `committed`.
 *
 * The pressed row toggles in the preview immediately. If it is already selected
 * and at least one other line is selected, the drag paints removal; otherwise it
 * paints addition, which preserves the non-empty selection invariant for a
 * single selected line.
 */
export function createMarqueeDrag(
  committed: ReadonlySet<number>,
  anchor: number,
  commit: MarqueeCommit,
): MarqueeDrag {
  const base = new Set(committed);
  const mode: MarqueeMode = base.has(anchor) && base.size > 1 ? "remove" : "add";
  let closed = false;
  let current = previewSelection(base, anchor, mode, [anchor], true);
  return {
    mode,
    anchor,
    preview: () => current,
    update(rows, forward) {
      if (!closed) {
        current = previewSelection(base, anchor, mode, rows, forward);
      }
      return current;
    },
    finish() {
      if (!closed) {
        closed = true;
        commit(current);
      }
      return current;
    },
    cancel() {
      closed = true;
    },
  };
}

/** Translate a viewport X into the list's content coordinates. */
export function listContentX(clientX: number, listLeft: number, borderLeft: number): number {
  return clientX - (listLeft + borderLeft);
}

/** Translate a viewport Y into the scrolling list's content coordinates. */
export function listContentY(
  clientY: number,
  listTop: number,
  borderTop: number,
  scrollTop: number,
): number {
  return clientY - (listTop + borderTop) + scrollTop;
}

/** Rectangle between the press point and the pointer, never thinner than 1px per axis. */
export function marqueeBox(start: MarqueePoint, pointer: MarqueePoint): MarqueeBox {
  return {
    left: Math.min(start.x, pointer.x),
    top: Math.min(start.y, pointer.y),
    width: Math.max(1, Math.abs(pointer.x - start.x)),
    height: Math.max(1, Math.abs(pointer.y - start.y)),
  };
}

/**
 * Candidate selection for the rows inside the rectangle.
 *
 * The anchor is always affected, even when the pointer later moves away from it,
 * matching the direction chosen at press. In removal mode the set keeps the last
 * touched row that was selected before the drag when removing everything would
 * empty it.
 */
function previewSelection(
  committed: ReadonlySet<number>,
  anchor: number,
  mode: MarqueeMode,
  rows: readonly number[],
  forward: boolean,
): MarqueePreview {
  const touched = uniqueRows(rows);
  // The pressed row is always affected, even after the pointer leaves it, and
  // leads the block so the caller can append exactly what the drag painted.
  const affected = uniqueRows([anchor, ...touched]);
  const next = new Set(committed);
  if (mode === "add") {
    next.add(anchor);
    for (const index of touched) {
      next.add(index);
    }
  } else {
    next.delete(anchor);
    for (const index of touched) {
      next.delete(index);
    }
    if (!next.size && touched.length) {
      const before = committed;
      const fallback =
        [...touched].reverse().find((index) => before.has(index)) ?? touched[touched.length - 1];
      next.add(fallback);
    }
  }

  const candidates = forward ? [...touched].reverse() : touched;
  const focus =
    candidates.find((index) => next.has(index)) ??
    (next.has(anchor) ? anchor : undefined) ??
    preferredFirst(next) ??
    anchor;
  return { selection: next, focus, mode, lines: affected };
}

/** Non-integer and duplicate row indices never enter a selection. */
function uniqueRows(rows: readonly number[]): number[] {
  return [...new Set(rows.filter((index) => Number.isInteger(index)))];
}

/** Lowest selected index, used when no touched row remains selected. */
function preferredFirst(selection: ReadonlySet<number>): number | undefined {
  let first: number | undefined;
  for (const value of selection) {
    if (first === undefined || value < first) {
      first = value;
    }
  }
  return first;
}
