/**
 * Shared right-click popup: an anchored action store plus the popover surface
 * that renders it.
 *
 * Sites own their actions and store. The popup measures once per snapshot,
 * clamps into the viewport, and returns focus to the anchor owner when a close
 * goes through `close`; light dismissal is left to `popover="auto"`.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createValue } from "../../../core/state/values.ts";
import { POPOVER_EDGE, type PopoverAlign } from "../../../design/patterns/useAnchoredPopover.ts";

/** One command offered by a context menu. */
export interface ContextMenuAction {
  id: string;
  label: string;
  tooltip?: string;
  icon?: string;
  /** Destructive commands keep danger ink in the popup. */
  danger?: boolean;
  /** Display text for the row's keyboard binding, when it has one. */
  shortcut?: string;
  enabled?(): boolean;
  run(): void;
}

/** Where a context menu opens and which element receives focus back. */
export interface ContextMenuAnchor {
  owner: HTMLElement | null;
  /** Horizontal baseline: the left edge for `start`, the centre for `center`, and the right edge for `end`. */
  x: number;
  y: number;
  /** Horizontal alignment against the measured menu; defaults to `start`. */
  align?: PopoverAlign;
}

/** A context menu anchor together with the actions to draw. */
export interface ContextMenuSnapshot extends ContextMenuAnchor {
  actions: readonly ContextMenuAction[];
}

/** Observable store holding at most one open context menu. */
export interface ContextMenuStore<T extends ContextMenuAnchor> {
  get(): T | null;
  subscribe(listener: () => void): () => void;
  set(snapshot: T | null): void;
}

/** Creates the observable store a site fills and the popup renders. */
export function createContextMenuState<T extends ContextMenuAnchor>(): ContextMenuStore<T> {
  const menu = createValue<T | null>({ initial: null });
  return Object.freeze({ get: menu.get, subscribe: menu.subscribe, set: menu.set });
}

/** The visible bounds a menu or its submenu must stay inside. */
export function contextMenuBounds(owner: HTMLElement | null): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const dialog = owner?.closest("dialog[open]");
  if (dialog) {
    const rect = dialog.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
}

/**
 * Style used before the menu has been measured.
 *
 * An `end` anchor already knows its visible right edge, so the unmeasured menu
 * can sit flush against it without guessing its width; the measured placement
 * then takes over with the actual width.
 */
function unmeasuredStyle(snapshot: ContextMenuAnchor): CSSProperties {
  if (snapshot.align === "end") {
    return {
      left: "auto",
      right: `${window.innerWidth - snapshot.x}px`,
      top: `${snapshot.y}px`,
    };
  }
  return { left: `${snapshot.x}px`, top: `${snapshot.y}px` };
}

/** Width of a submenu's floating preview card, mirrored by `contextMenu.less`. */
const SUBMENU_PREVIEW_WIDTH = 180;

/** Focuses the first visible, enabled item of an open menu. */
function focusFirstItem(menu: HTMLElement): void {
  const items = [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  items.find((item) => item.checkVisibility())?.focus();
}

/** Keyboard navigation for a popup menu. */
export function navigateMenu(event: KeyboardEvent<HTMLElement>, close: () => void): void {
  const root = event.currentTarget;
  const items = [
    ...root.querySelectorAll<HTMLButtonElement>("button:not(:disabled):not([hidden])"),
  ].filter((item) => item.checkVisibility());
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  if (["ArrowDown", "ArrowUp", "Home", "End", "Escape"].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      close();
    } else {
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    }
  }
}

/**
 * The shared right-click popup.
 *
 * Native `popover="auto"` supplies light dismissal, so no site listens for
 * outside pointer events. The snapshot carries the pointer position only, so the
 * popup measures itself once open and clamps into the viewport. The measurement
 * is kept next to the snapshot it belongs to, so an unmeasured menu paints at
 * the pointer immediately.
 *
 * `close` clears the snapshot and nothing else. Hiding and handing focus back
 * to the surface stay in the effect, so the callback is safe to hand to the
 * menu's rows.
 */
export function ContextMenuPopup<T extends ContextMenuAnchor>({
  store,
  label,
  className = "",
  submenu,
  children,
}: {
  store: ContextMenuStore<T>;
  label: string;
  /** Extra class for the site's own composition details, on top of the shared look. */
  className?: string;
  /** A sibling menu that opens beside this one, inside the same popover. */
  submenu?: ReactNode;
  children(snapshot: T, close: () => void): ReactNode;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.get, store.get);
  const popup = useRef<HTMLDivElement>(null);
  const owner = useRef<HTMLElement | null>(null);
  const [placement, setPlacement] = useState<{
    snapshot: T;
    left: string;
    top: string;
  }>();
  const labelId = useId();
  const close = useCallback(() => store.set(null), [store]);

  // A popup is its own scroll context. The editor routes wheel input at the
  // window level, so the wheel over a list must never reach the workspace
  // behind it. Native scrolling stays in charge for smooth trackpads; a
  // capture owner that already refused the default keeps its gesture honored
  // here.
  useEffect(() => {
    const menu = popup.current;
    if (!menu) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.stopPropagation();
      const target = event.target instanceof Element ? event.target : null;
      const scroller = target?.closest<HTMLElement>(".redux-menu-scroll") ?? null;
      if (!scroller || !menu.contains(scroller)) {
        event.preventDefault();
        return;
      }
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1;
      if (event.defaultPrevented) {
        event.preventDefault();
        scroller.scrollTop += event.deltaY * unit;
        return;
      }
      const atTop = scroller.scrollTop <= 0 && event.deltaY < 0;
      const atBottom =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1 && event.deltaY > 0;
      // Keep a wheel that reaches either end - or a menu with nothing to
      // scroll - from chaining into the canvas or timeline below.
      if (atTop || atBottom || scroller.scrollHeight <= scroller.clientHeight) {
        event.preventDefault();
      }
    };
    menu.addEventListener("wheel", onWheel, { passive: false });
    return () => menu.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const menu = popup.current;
    if (!menu) {
      return;
    }
    if (!snapshot) {
      // Only a close that went through `close` still has the popover showing. A
      // light dismissal arrives here already closed, and the browser restores
      // focus for that path on its own.
      const wasShowing = menu.matches(":popover-open");
      menu.hidePopover();
      if (wasShowing) {
        const target = owner.current;
        if (target?.isConnected && !target.closest("[inert]")) {
          target.focus();
        }
        owner.current = null;
      }
      return;
    }
    owner.current = snapshot.owner;
    if (!menu.matches(":popover-open")) {
      menu.showPopover();
    }
    const anchor = snapshot.owner?.getBoundingClientRect();
    const offsetX = anchor ? snapshot.x - anchor.left : 0;
    const offsetY = anchor ? snapshot.y - anchor.bottom : 0;
    let frame = 0;
    let focused = false;
    /** Re-place the menu from the owner's current position and parent bounds. */
    const place = () => {
      if (!menu.matches(":popover-open")) {
        return;
      }
      const current = snapshot.owner?.isConnected ? snapshot.owner.getBoundingClientRect() : null;
      const anchorX = current ? current.left + offsetX : snapshot.x;
      const anchorY = current ? current.bottom + offsetY : snapshot.y;
      const bounds = contextMenuBounds(snapshot.owner);
      const maxHeight = Math.max(0, bounds.bottom - bounds.top - 2 * POPOVER_EDGE);
      menu.style.setProperty("--redux-menu-max-height", `${maxHeight}px`);
      const width = menu.offsetWidth;
      const height = Math.min(menu.offsetHeight, maxHeight);
      let left = anchorX;
      if (snapshot.align === "end") {
        left = anchorX - width;
      } else if (snapshot.align === "center") {
        left = anchorX - width / 2;
      }
      const minLeft = bounds.left + POPOVER_EDGE;
      const maxLeft = bounds.right - width - POPOVER_EDGE;
      left = maxLeft < minLeft ? minLeft : Math.min(Math.max(left, minLeft), maxLeft);
      const minTop = bounds.top + POPOVER_EDGE;
      const maxTop = bounds.bottom - height - POPOVER_EDGE;
      const top = maxTop < minTop ? minTop : Math.min(Math.max(anchorY, minTop), maxTop);
      setPlacement({
        snapshot,
        left: `${left}px`,
        top: `${top}px`,
      });
      if (!focused) {
        focused = true;
        focusFirstItem(menu);
      }
    };
    /** Coalesce scroll and resize events into the next frame. */
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const onScroll = (event: Event) => {
      if (event.target !== menu) {
        schedule();
      }
    };
    frame = requestAnimationFrame(place);
    const resize = new ResizeObserver(schedule);
    resize.observe(menu);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", schedule);
    };
  }, [snapshot]);

  const measured = placement?.snapshot === snapshot ? placement : null;
  return (
    <div
      ref={popup}
      popover="auto"
      role="menu"
      aria-labelledby={labelId}
      className={`redux-menu-popup ${className}`.trim()}
      style={
        measured
          ? { left: measured.left, top: measured.top }
          : snapshot
            ? unmeasuredStyle(snapshot)
            : undefined
      }
      onToggle={(event) => {
        if (event.newState === "closed" && store.get()) {
          store.set(null);
        }
      }}
      onKeyDown={(event) => navigateMenu(event, close)}
    >
      <span id={labelId} className="redux-visually-hidden">
        {label}
      </span>
      <div className="redux-menu-scroll">{snapshot ? children(snapshot, close) : null}</div>
      {snapshot ? submenu : null}
    </div>
  );
}

/**
 * A sibling menu that opens beside its parent context menu.
 *
 * It renders inside the parent popover so the native light-dismiss contract
 * still treats both surfaces as one open menu. The side follows the available
 * space in the parent dialog and flips left when the right edge is too close.
 */
export function ContextMenuSubmenu({
  label,
  loading = false,
  preview,
  previewTop = 0,
  onClose,
  children,
}: {
  label: string;
  /** Hold focus on the container until the first row arrives. */
  loading?: boolean;
  /** A non-interactive card shown beside the submenu for the active row. */
  preview?: ReactNode;
  /** The preview card's top offset inside the submenu. */
  previewTop?: number;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [side, setSide] = useState<"left" | "right">("right");
  const [previewSide, setPreviewSide] = useState<"left" | "right">("right");
  const [top, setTop] = useState<number>();
  const [maxHeight, setMaxHeight] = useState<number>();

  useLayoutEffect(() => {
    const node = ref.current;
    const parent = node?.parentElement;
    if (!node || !parent) {
      return undefined;
    }
    let frame = 0;
    /** Choose the roomier side and cap the submenu inside the parent's dialog. */
    const place = () => {
      const bounds = contextMenuBounds(parent);
      const parentRect = parent.getBoundingClientRect();
      const width = node.offsetWidth;
      const rightRoom = bounds.right - parentRect.right - POPOVER_EDGE;
      const leftRoom = parentRect.left - bounds.left - POPOVER_EDGE;
      const nextSide = rightRoom >= width || rightRoom >= leftRoom ? "right" : "left";
      // Line the submenu up with the row that opened it, keeping it inside the
      // same dialog bounds as the parent.
      const row = parent.querySelector<HTMLElement>('[aria-haspopup="menu"][aria-expanded="true"]');
      const rowTop = row?.getBoundingClientRect().top ?? parentRect.top;
      const anchorTop = Math.min(
        Math.max(rowTop, bounds.top + POPOVER_EDGE),
        Math.max(bounds.top + POPOVER_EDGE, bounds.bottom - POPOVER_EDGE),
      );
      setSide(nextSide);
      // The preview card prefers the submenu's outer edge, away from the
      // parent menu, and falls back to the inner edge when that side is short.
      const submenuLeft = nextSide === "right" ? parentRect.right : parentRect.left - width;
      const submenuRight = submenuLeft + width;
      const previewRightRoom = bounds.right - submenuRight - POPOVER_EDGE;
      const previewLeftRoom = submenuLeft - bounds.left - POPOVER_EDGE;
      const preferred = nextSide;
      const other = nextSide === "right" ? "left" : "right";
      const room = (edge: "left" | "right") =>
        edge === "right" ? previewRightRoom : previewLeftRoom;
      setPreviewSide(
        room(preferred) >= SUBMENU_PREVIEW_WIDTH || room(other) < SUBMENU_PREVIEW_WIDTH
          ? preferred
          : other,
      );
      setTop(Math.max(0, anchorTop - parentRect.top));
      setMaxHeight(Math.max(0, bounds.bottom - anchorTop - 2 * POPOVER_EDGE));
    };
    /** Coalesce scroll and resize events into the next frame. */
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    const resize = new ResizeObserver(schedule);
    resize.observe(node);
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const previous = previousFocus.current;
      if (previous?.isConnected && previous.checkVisibility()) {
        previous.focus();
      }
    };
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    if (loading) {
      node.focus();
      return;
    }
    node.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [loading]);

  return (
    <div
      ref={ref}
      className="redux-menu-submenu"
      role="menu"
      aria-label={label}
      data-side={side}
      tabIndex={-1}
      style={
        maxHeight === undefined
          ? undefined
          : ({
              top: top === undefined ? undefined : `${top}px`,
              "--redux-menu-submenu-max-height": `${maxHeight}px`,
            } as CSSProperties)
      }
      onKeyDown={(event) => navigateMenu(event, onClose)}
    >
      <span className="redux-visually-hidden">{label}</span>
      <div className="redux-menu-scroll">{children}</div>
      {preview ? (
        <div
          className="redux-menu-preview"
          data-side={previewSide}
          style={{ top: `${previewTop}px` }}
          aria-hidden="true"
        >
          {preview}
        </div>
      ) : null}
    </div>
  );
}
