/**
 * Reveals a row or folder that the line tree has just created.
 *
 * Creation appends a line at the end of its folder and inserts a folder after
 * the active one; either can land outside the tree's capped viewport, so the
 * tree records the target before the commit and this hook scrolls it into the
 * visible window once the committed layout has painted.
 */
import { useLayoutEffect, type RefObject } from "react";

/** One created row or folder waiting to be revealed after its commit. */
export type LineTreeReveal = { kind: "line"; index: number } | { kind: "group"; group: number };

/** Scrolls the pending created row or folder into the tree's visible window. */
export function useLineTreeReveal(
  listRef: RefObject<HTMLDivElement | null>,
  rowRefs: RefObject<Map<number, HTMLElement>>,
  pending: RefObject<LineTreeReveal | null>,
  revision: number,
  folderGroup: number | null,
): void {
  useLayoutEffect(() => {
    const reveal = pending.current;
    pending.current = null;
    const container = listRef.current;
    if (!reveal || !container) {
      return;
    }
    const target =
      reveal.kind === "line"
        ? rowRefs.current.get(reveal.index)
        : container.querySelector<HTMLElement>(`[data-group-index="${reveal.group}"]`);
    if (!target) {
      return;
    }
    const viewport = container.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const top = container.scrollTop + box.top - viewport.top;
    const bottom = top + box.height;
    if (top < container.scrollTop) {
      container.scrollTop = top;
    } else if (bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = bottom - container.clientHeight;
    }
  }, [folderGroup, listRef, pending, revision, rowRefs]);
}
