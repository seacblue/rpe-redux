/**
 * Anchored popover behaviour shared by menus, pickers, and task panels.
 *
 * The hook owns viewport placement, outside dismissal, Escape handling, focus
 * restoration, and frame-tracked anchor following. Callers own the panel surface
 * and its content; they should not repeat the same placement and dismissal
 * effects.
 *
 * Anchor movement is not an event: a panel animates, a list scrolls under the
 * control, or playback shifts the row. `floatingAnchor.ts` measures every open
 * surface on one shared frame loop, so this hook never installs its own scroll,
 * resize, or lifecycle poll.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { trackFloatingAnchor } from "./floatingAnchor.ts";
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
  /** Close on page scroll instead of following it; scrolls inside the panel are ignored. */
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
  const anchorBox = useRef<DOMRectReadOnly | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      // Keep the last placement so a mounted panel animates out where it opened.
      return;
    }
    /** Place the panel from the last measured anchor box. */
    const place = () => {
      const node = panel.current;
      const box = anchorBox.current;
      if (!node || !box) {
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
    const releases: Array<() => void> = [];
    const anchorElement = anchor.current;
    if (anchorElement) {
      releases.push(
        trackFloatingAnchor(anchorElement, (box, change, event) => {
          anchorBox.current = box;
          if (!box) {
            close.current();
            return;
          }
          if (change === "scroll") {
            const target = event?.target;
            if (target instanceof Node && panel.current?.contains(target)) {
              return;
            }
            if (closeOnScroll) {
              close.current();
              return;
            }
          }
          place();
        }),
      );
    }
    const panelElement = panel.current;
    if (panelElement) {
      // The panel's own size is measured on the same loop: a message row that
      // wraps or a picker that loads more options re-places without its own
      // ResizeObserver. Its internal scroll is not a placement change.
      releases.push(
        trackFloatingAnchor(panelElement, (_box, change) => {
          if (change !== "scroll") {
            place();
          }
        }),
      );
    }
    return () => {
      for (const release of releases) {
        release();
      }
    };
  }, [align, anchor, closeOnScroll, gap, matchAnchorWidth, maxHeight, open, panel]);

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
