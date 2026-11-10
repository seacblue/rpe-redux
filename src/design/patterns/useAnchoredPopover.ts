/**
 * Anchored popover behaviour shared by menus, pickers, and task panels.
 *
 * The hook owns viewport placement, outside dismissal, Escape handling, focus
 * restoration, and resize/scroll tracking. Callers own the panel surface and its
 * content; they should not repeat the same placement and dismissal effects.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { useHoldFloatingSurface } from "./floatingSurface.ts";

export type PopoverAlign = "start" | "center" | "end";
export type PopoverSide = "top" | "bottom";

export interface AnchoredPopoverOptions {
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  panel: RefObject<HTMLElement | null>;
  onClose(): void;
  /** Horizontal alignment against the anchor; defaults to start. */
  align?: PopoverAlign;
  /** Space between anchor and panel. */
  gap?: number;
  /** Give the panel the anchor's width. */
  matchAnchorWidth?: boolean;
  /** Preferred maximum height; the viewport still caps it. */
  maxHeight?: number;
  /** Return focus to the anchor when Escape closes the panel. */
  restoreFocus?: boolean;
  /** Element to focus on Escape instead of the anchor. */
  focusTarget?: RefObject<HTMLElement | null>;
  /** A trigger that toggles the panel; pressing it must reach its own handler. */
  toggle?: RefObject<HTMLElement | null>;
  /** Close on page scroll instead of repositioning. */
  closeOnScroll?: boolean;
  /** Consume the outside pointerdown so a modal behind the popover does not also close. */
  blockOutsidePointer?: boolean;
}

export interface AnchoredPopoverStyle extends CSSProperties {
  left: number;
  top: number;
  width?: number;
  maxHeight?: number;
  "--popover-origin-x": string;
  "--popover-origin-y": string;
}

/** Minimum distance kept between a popover and the viewport edge, in pixels. */
export const POPOVER_EDGE = 8;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Resolve a popover's left offset from one alignment baseline.
 *
 * The baseline is the anchor's left edge for `start`, its centre for `center`,
 * and its right edge for `end`. The measured panel width is required so `end`
 * puts the panel's right edge on that baseline without a caller-supplied
 * offset. The result stays inside the viewport with `edge` pixels of breathing
 * room.
 */
export function resolvePopoverLeft(
  baseline: number,
  width: number,
  viewportWidth: number,
  align: PopoverAlign = "start",
  edge = POPOVER_EDGE,
): number {
  const ideal =
    align === "end" ? baseline - width : align === "center" ? baseline - width / 2 : baseline;
  return clamp(ideal, edge, Math.max(edge, viewportWidth - width - edge));
}

/** Place, dismiss, and focus one popover attached to an anchor. */
export function useAnchoredPopover({
  open,
  anchor,
  panel,
  onClose,
  align = "start",
  gap = 6,
  matchAnchorWidth = false,
  maxHeight,
  restoreFocus = true,
  focusTarget,
  toggle,
  closeOnScroll = false,
  blockOutsidePointer = false,
}: AnchoredPopoverOptions): {
  style: AnchoredPopoverStyle;
  side: PopoverSide;
} {
  useHoldFloatingSurface(open);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width?: number;
    maxHeight?: number;
    side: PopoverSide;
    originX: number;
    originY: number;
  } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    if (!open) {
      // Keep the last placement so a mounted panel animates out where it opened.
      return;
    }
    const place = () => {
      const anchorElement = anchor.current;
      const node = panel.current;
      if (!anchorElement || !node) {
        return;
      }
      if (
        !anchorElement.isConnected ||
        anchorElement.checkVisibility?.({ checkVisibilityCSS: true }) === false
      ) {
        close.current();
        return;
      }
      const box = anchorElement.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) {
        close.current();
        return;
      }
      const measuredWidth = node.offsetWidth;
      const measuredHeight = node.offsetHeight;
      const width = matchAnchorWidth ? box.width : measuredWidth;
      const height = Math.min(measuredHeight, window.innerHeight - POPOVER_EDGE * 2);
      const below = box.bottom + gap;
      const above = box.top - gap - height;
      const side: PopoverSide =
        below + height <= window.innerHeight - POPOVER_EDGE || above < POPOVER_EDGE
          ? "bottom"
          : "top";
      const top = clamp(
        side === "bottom" ? below : above,
        POPOVER_EDGE,
        Math.max(POPOVER_EDGE, window.innerHeight - height - POPOVER_EDGE),
      );
      const baseline =
        align === "end" ? box.right : align === "center" ? box.left + box.width / 2 : box.left;
      const left = resolvePopoverLeft(baseline, width, window.innerWidth, align);
      const originX = clamp(box.left + box.width / 2 - left, 10, Math.max(10, width - 10));
      const next = {
        left,
        top,
        ...(matchAnchorWidth ? { width } : {}),
        ...(maxHeight
          ? { maxHeight: Math.min(maxHeight, window.innerHeight - top - POPOVER_EDGE) }
          : {}),
        side,
        originX,
        originY: side === "bottom" ? 0 : height,
      };
      setPosition((previous) =>
        previous &&
        previous.left === next.left &&
        previous.top === next.top &&
        previous.width === next.width &&
        previous.maxHeight === next.maxHeight &&
        previous.side === next.side &&
        previous.originX === next.originX &&
        previous.originY === next.originY
          ? previous
          : next,
      );
    };
    place();
    const update = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && panel.current?.contains(target)) {
        return;
      }
      if (closeOnScroll) {
        close.current();
        return;
      }
      place();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", update, true);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => place());
    if (panel.current) {
      observer?.observe(panel.current);
    }
    if (anchor.current) {
      observer?.observe(anchor.current);
    }
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", update, true);
      observer?.disconnect();
    };
  }, [align, anchor, closeOnScroll, gap, matchAnchorWidth, maxHeight, open, panel]);

  useEffect(() => {
    if (!open) {
      return;
    }
    // Parent panels can close, collapse, or unmount without a scroll or resize
    // event. The poll is the lifecycle signal that keeps a portalled popover
    // from outliving the control it belongs to.
    const check = () => {
      const anchorElement = anchor.current;
      if (
        !anchorElement ||
        !anchorElement.isConnected ||
        anchorElement.checkVisibility?.({ checkVisibilityCSS: true }) === false
      ) {
        close.current();
      }
    };
    const timer = window.setInterval(check, 120);
    return () => window.clearInterval(timer);
  }, [anchor, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        panel.current?.contains(target) ||
        anchor.current?.contains(target) ||
        toggle?.current?.contains(target)
      ) {
        return;
      }
      if (blockOutsidePointer) {
        event.preventDefault();
        event.stopPropagation();
      }
      close.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      close.current();
      if (restoreFocus) {
        (focusTarget?.current ?? anchor.current)?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [anchor, blockOutsidePointer, focusTarget, open, panel, restoreFocus, toggle]);

  return {
    side: position?.side ?? "bottom",
    style: {
      left: position?.left ?? 0,
      top: position?.top ?? 0,
      ...(position?.width !== undefined ? { width: position.width } : {}),
      ...(position?.maxHeight !== undefined ? { maxHeight: position.maxHeight } : {}),
      "--popover-origin-x": `${position?.originX ?? 0}px`,
      "--popover-origin-y": `${position?.originY ?? 0}px`,
    },
  };
}
