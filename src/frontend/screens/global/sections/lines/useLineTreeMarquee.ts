/**
 * Windows-style pointer selection for the judge-line tree.
 *
 * A plain drag replaces the captured selection, Ctrl/Cmd adds or removes the
 * rows inside the rectangle, and Shift adds them. A click is handed back to
 * the tree's common click rule so the same focus/range semantics apply to
 * both a click and a drag.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { JudgeLine } from "../../../../../core/global/chart/chart.ts";
import {
  listSelectionAfterMarquee,
  type ListSelectionModifiers,
} from "../../../../../design/patterns/list/listSelection.ts";
import { lineTreeKey } from "./lineTreeModel.ts";
import { resolveLineTreeMarqueeFocus, topmostLineInSelection } from "./lineTreeSelection.ts";

const MARQUEE_THRESHOLD = 4;

/** The visible selection rectangle plus the selection it previews. */
export interface MarqueeBox {
  left: number;
  top: number;
  width: number;
  height: number;
  hits: ReadonlySet<string>;
}

interface MarqueeGesture {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startKey: string | null;
  initial: Set<string>;
  hits: Set<string>;
  firstLine: string | null;
  focusLine: string | null;
  modifiers: ListSelectionModifiers;
  moved: boolean;
}

interface MarqueeOptions {
  listRef: RefObject<HTMLDivElement | null>;
  rowRefs: MutableRefObject<Map<number, HTMLElement>>;
  lines: readonly JudgeLine[];
  selectedIds: ReadonlySet<string>;
  lineIndices: ReadonlyMap<string, number>;
  order: readonly string[];
  currentScroll(): number;
  onSelectionChange(ids: ReadonlySet<string>): void;
  onSelectionFirstLineChange?(index: number): void;
  onSelectionFocusChange?(index: number): void;
  onSelectLine(index: number, scrollTop: number): void;
  onClick(index: number, modifiers: ListSelectionModifiers): void;
}

/** Marquee state and the pointerdown entry point for the tree surface. */
export function useLineTreeMarquee({
  listRef,
  rowRefs,
  lines,
  selectedIds,
  lineIndices,
  order,
  currentScroll,
  onSelectionChange,
  onSelectionFirstLineChange,
  onSelectionFocusChange,
  onSelectLine,
  onClick,
}: MarqueeOptions) {
  const [marquee, setMarquee] = useState<MarqueeBox | null>(null);
  const marqueeRef = useRef<MarqueeGesture | null>(null);
  const marqueeCleanup = useRef<(() => void) | null>(null);
  const optionsRef = useRef<MarqueeOptions>({
    listRef,
    rowRefs,
    lines,
    selectedIds,
    lineIndices,
    order,
    currentScroll,
    onSelectionChange,
    onSelectionFirstLineChange,
    onSelectionFocusChange,
    onSelectLine,
    onClick,
  });
  useEffect(() => {
    optionsRef.current = {
      listRef,
      rowRefs,
      lines,
      selectedIds,
      lineIndices,
      order,
      currentScroll,
      onSelectionChange,
      onSelectionFirstLineChange,
      onSelectionFocusChange,
      onSelectLine,
      onClick,
    };
  }, [
    listRef,
    rowRefs,
    lines,
    selectedIds,
    lineIndices,
    order,
    currentScroll,
    onSelectionChange,
    onSelectionFirstLineChange,
    onSelectionFocusChange,
    onSelectLine,
    onClick,
  ]);

  useEffect(
    () => () => {
      marqueeCleanup.current?.();
    },
    [],
  );

  const beginMarquee = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const currentOptions = optionsRef.current;
    if (event.button !== 0) {
      return;
    }
    const targetRow =
      event.currentTarget.dataset.lineIndex !== undefined
        ? event.currentTarget
        : event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>("[data-line-index]")
          : null;
    const startIndex = Number(targetRow?.dataset.lineIndex);
    const startKey =
      Number.isInteger(startIndex) && startIndex >= 0 && startIndex < currentOptions.lines.length
        ? lineTreeKey(currentOptions.lines, startIndex)
        : null;
    event.preventDefault();
    const modifiers: ListSelectionModifiers = {
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    };
    const gesture: MarqueeGesture = {
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      startKey,
      initial: new Set(currentOptions.selectedIds),
      hits: new Set(currentOptions.selectedIds),
      firstLine: startKey,
      focusLine: startKey,
      modifiers,
      moved: false,
    };
    marqueeRef.current = gesture;
    marqueeCleanup.current?.();

    const cleanup = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", cancel);
      marqueeCleanup.current = null;
    };

    const move = (pointer: PointerEvent) => {
      const current = marqueeRef.current;
      if (!current) {
        return;
      }
      current.currentX = pointer.clientX;
      current.currentY = pointer.clientY;
      if (
        !current.moved &&
        Math.hypot(current.currentX - current.startX, current.currentY - current.startY) <
          MARQUEE_THRESHOLD
      ) {
        return;
      }
      current.moved = true;
      const left = Math.min(current.startX, current.currentX);
      const top = Math.min(current.startY, current.currentY);
      const right = Math.max(current.startX, current.currentX);
      const bottom = Math.max(current.startY, current.currentY);
      const touched: string[] = [];
      if (currentOptions.listRef.current) {
        for (const node of currentOptions.rowRefs.current.values()) {
          if (!node.isConnected || node.hidden) {
            continue;
          }
          const index = Number(node.dataset.lineIndex);
          if (!Number.isInteger(index) || index < 0 || index >= currentOptions.lines.length) {
            continue;
          }
          const box = node.getBoundingClientRect();
          if (box.bottom < top || box.top > bottom || box.right < left || box.left > right) {
            continue;
          }
          touched.push(lineTreeKey(currentOptions.lines, index));
        }
      }
      current.firstLine =
        topmostLineInSelection(currentOptions.order, touched) ?? current.firstLine;
      const preview = listSelectionAfterMarquee(
        currentOptions.order,
        current.initial,
        touched,
        current.modifiers,
        true,
      );
      current.hits = new Set(preview.selection);
      current.focusLine =
        resolveLineTreeMarqueeFocus(
          currentOptions.order,
          current.initial,
          touched,
          current.modifiers,
        ) ?? preview.focus;
      setMarquee({ left, top, width: right - left, height: bottom - top, hits: current.hits });
    };

    const blockNextClick = () => {
      const blockClick = (click: MouseEvent) => {
        click.preventDefault();
        click.stopImmediatePropagation();
        window.removeEventListener("click", blockClick, true);
      };
      window.addEventListener("click", blockClick, true);
      window.setTimeout(() => window.removeEventListener("click", blockClick, true), 300);
    };

    const finish = () => {
      const current = marqueeRef.current;
      cleanup();
      marqueeRef.current = null;
      setMarquee(null);
      if (!current) {
        return;
      }
      blockNextClick();
      const latest = optionsRef.current;
      if (!current.moved) {
        const index = current.startKey ? latest.lineIndices.get(current.startKey) : undefined;
        if (index !== undefined) {
          latest.onClick(index, current.modifiers);
        }
        return;
      }
      const changed =
        current.hits.size !== current.initial.size ||
        [...current.hits].some((id) => !current.initial.has(id));
      if (!changed && !current.modifiers.shiftKey) {
        return;
      }
      if (current.modifiers.shiftKey && !current.firstLine) {
        return;
      }
      const focusId = current.focusLine ?? [...current.hits][0];
      const focusIndex = focusId === undefined ? undefined : latest.lineIndices.get(focusId);
      if (focusIndex === undefined) {
        return;
      }
      if (changed) {
        latest.onSelectionChange(new Set(current.hits));
      }
      const firstLineIndex = current.firstLine
        ? latest.lineIndices.get(current.firstLine)
        : focusIndex;
      latest.onSelectionFirstLineChange?.(firstLineIndex ?? focusIndex);
      if (current.modifiers.shiftKey) {
        latest.onSelectionFocusChange?.(focusIndex);
        latest.onSelectLine(focusIndex, latest.currentScroll());
      }
    };

    const cancel = () => {
      cleanup();
      marqueeRef.current = null;
      setMarquee(null);
    };

    marqueeCleanup.current = cleanup;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("blur", cancel);
  }, []);

  return { marquee, beginMarquee };
}
