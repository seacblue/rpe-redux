/**
 * Shift-drag marquee selection for the judge-line tree.
 *
 * The rectangle unions every intersecting row with the selection captured at
 * pointerdown, so a drag adds to an existing multi-selection. Releasing without
 * movement falls back to a Shift-click toggle. Window listeners are installed
 * for one gesture and removed on release, cancel, blur, or unmount.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MutableRefObject,
  type RefObject,
} from "react";
import type { JudgeLine } from "../../../../../core/global/chart/chart.ts";
import { lineTreeKey } from "./lineTreeModel.ts";

const MARQUEE_THRESHOLD = 4;

/** The visible selection rectangle plus the row keys it covers. */
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
  moved: boolean;
}

interface MarqueeOptions {
  listRef: RefObject<HTMLDivElement | null>;
  rowRefs: MutableRefObject<Map<number, HTMLElement>>;
  lines: readonly JudgeLine[];
  selectedIds: ReadonlySet<string>;
  lineIndices: ReadonlyMap<string, number>;
  focusAfterRemoval(removed: number, next: ReadonlySet<string>): number;
  currentScroll(): number;
  onSelectionChange(ids: ReadonlySet<string>): void;
  onSelectLine(index: number, scrollTop: number): void;
}

/** Marquee state and the pointerdown entry point for the tree surface. */
export function useLineTreeMarquee({
  listRef,
  rowRefs,
  lines,
  selectedIds,
  lineIndices,
  focusAfterRemoval,
  currentScroll,
  onSelectionChange,
  onSelectLine,
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
    focusAfterRemoval,
    currentScroll,
    onSelectionChange,
    onSelectLine,
  });
  useEffect(() => {
    optionsRef.current = {
      listRef,
      rowRefs,
      lines,
      selectedIds,
      lineIndices,
      focusAfterRemoval,
      currentScroll,
      onSelectionChange,
      onSelectLine,
    };
  }, [
    listRef,
    rowRefs,
    lines,
    selectedIds,
    lineIndices,
    focusAfterRemoval,
    currentScroll,
    onSelectionChange,
    onSelectLine,
  ]);

  useEffect(
    () => () => {
      marqueeCleanup.current?.();
    },
    [],
  );

  const beginMarquee = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const currentOptions = optionsRef.current;
    if (event.button !== 0 || !event.shiftKey) {
      return;
    }
    const startIndex = Number(event.currentTarget.dataset.lineIndex);
    const startKey =
      Number.isInteger(startIndex) && startIndex >= 0 && startIndex < currentOptions.lines.length
        ? lineTreeKey(currentOptions.lines, startIndex)
        : null;
    event.preventDefault();
    const gesture: MarqueeGesture = {
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      startKey,
      initial: new Set(currentOptions.selectedIds),
      hits: new Set(currentOptions.selectedIds),
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
      const hits = new Set(current.initial);
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
          hits.add(lineTreeKey(currentOptions.lines, index));
        }
      }
      current.hits = hits;
      setMarquee({ left, top, width: right - left, height: bottom - top, hits });
    };

    const blockNextClick = () => {
      // Browser click dispatch follows pointerup and would otherwise re-run the
      // row's own click handler over the selection this gesture just made.
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
      if (!current.moved) {
        if (!current.startKey) {
          return;
        }
        blockNextClick();
        const index = optionsRef.current.lineIndices.get(current.startKey);
        if (index === undefined) {
          return;
        }
        const next = new Set(current.initial);
        if (next.has(current.startKey)) {
          if (next.size > 1) {
            next.delete(current.startKey);
          }
        } else {
          next.add(current.startKey);
        }
        if (!next.size) {
          next.add(current.startKey);
        }
        const latest = optionsRef.current;
        const focusIndex = next.has(current.startKey)
          ? index
          : latest.focusAfterRemoval(index, next);
        latest.onSelectionChange(next);
        latest.onSelectLine(focusIndex, latest.currentScroll());
        return;
      }
      blockNextClick();
      const changed =
        current.hits.size !== current.initial.size ||
        [...current.hits].some((id) => !current.initial.has(id));
      if (!changed) {
        return;
      }
      const hitIndices = [...current.hits]
        .flatMap((id) => {
          const index = optionsRef.current.lineIndices.get(id);
          return index === undefined ? [] : [index];
        })
        .sort((left, right) => left - right);
      if (!hitIndices.length) {
        return;
      }
      const focus = hitIndices[0];
      const latest = optionsRef.current;
      latest.onSelectionChange(new Set(current.hits));
      latest.onSelectLine(focus, latest.currentScroll());
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
