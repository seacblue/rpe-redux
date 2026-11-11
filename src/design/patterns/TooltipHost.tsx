/**
 * Shared tooltip host: one document-level layer that reads `data-tip-*` markup,
 * positions a tip against its anchor, and appends live shortcut chips through an
 * injected lookup. Product surfaces supply the text, not the tip.
 *
 * The listeners live on the document rather than on the app shell so window
 * controls, body portals, and modal dialogs reach the same broker. Tips inside
 * an open dialog therefore keep working; the dialog's own scrim keeps tips that
 * belong to the surface underneath from being hovered.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { clamp } from "../../core/utils/numbers.ts";
import { MODAL_STACK_EVENT } from "../../core/shell/shellEventNames.ts";
import { KbdBindings, type KbdStroke } from "../components/keyboardHint/Kbd.tsx";
import { tooltipTitle } from "./tooltipTitle.ts";

/**
 * Where the keyboard shortcut shown in a tip comes from. A tip's text is read
 * from the markup, but a shortcut is a *live* binding owned by the shortcut
 * registry in the app layer, so the app hands that single lookup in rather than
 * this layer reaching up into it.
 */
export type ShortcutLookup = (actionId: string, shortcutId?: string) => readonly KbdStroke[];

let lookupShortcut: ShortcutLookup = () => [];

/** Register the lookup that supplies live shortcut chips to tooltips. */
export function setShortcutLookup(lookup: ShortcutLookup): void {
  lookupShortcut = lookup;
}

/** A tip shown by a canvas or another imperative surface. */
export interface TransientTip {
  title: string;
  description?: string;
  /** Anchor used for lifetime and placement. */
  anchor: HTMLElement;
  /** Viewport point for a pointer-placed tip. */
  pointer?: { x: number; y: number };
}

let showTransient: ((tip: TransientTip | null) => void) | null = null;

/**
 * Show or clear a tip from a surface that paints its own hover regions.
 *
 * Canvas strips cannot carry `data-tip-*` per region, so they publish the label
 * under the pointer through this broker. Passing `null` clears it; the next
 * annotated control takes over on its own hover.
 */
export function setTransientTooltip(tip: TransientTip | null): void {
  showTransient?.(tip);
}

interface Tip {
  title: string;
  description: string;
  video: string;
  strokes: readonly KbdStroke[];
  anchor: HTMLElement;
  pointer?: { x: number; y: number };
  /** An imperative caller may choose the placement instead of the markup. */
  placement?: "left" | "pointer" | "edge";
}

/** Which edge of the tip carries the arrow, and where along that edge it sits. */
type TipArrow = "top" | "bottom" | "left" | "right" | "none";

interface TipPosition {
  left: number;
  top: number;
  arrow: TipArrow;
  /** Distance from the tip's left (horizontal arrows) or top (vertical) edge. */
  offset: number;
}

/**
 * Whether a control already owns an open surface.
 *
 * A trigger that has expanded its popover, or that controls an element still
 * present and visible, must not explain itself with a tooltip: the tip would
 * cover the very surface the control just opened.
 */
function isEngaged(element: HTMLElement): boolean {
  if (element.getAttribute("aria-expanded") === "true") {
    return true;
  }
  const controls = element.getAttribute("aria-controls");
  if (!controls) {
    return false;
  }
  return controls.split(/\s+/).some((id) => {
    const target = element.ownerDocument.getElementById(id);
    return Boolean(
      target?.isConnected && target.checkVisibility?.({ checkVisibilityCSS: true }) === true,
    );
  });
}

/**
 * The single tooltip broker.
 *
 * There is exactly one tooltip element, in the top layer, positioned from the
 * hovered control's bounding box, so a scrolling container cannot clip it. The
 * panel is attached to the control — by default its top edge sits a hair below
 * the button's bottom edge — and it repeats the button's shape (same radius,
 * same hairline) so the two read as one object.
 *
 * An ancestor can ask for the tip on its left with `data-tip-placement="left"`:
 * a vertical rail flush against the window's right edge has no room to the right.
 * The tip is then centred on the button and hugs its left edge.
 *
 * Content comes from the markup, never from a second registry: a control
 * annotates itself with `data-tip-title` / `data-tip-desc` / `data-tip-key`.
 */
/** Provide the tooltip element and install the document-level capture listeners. */
export function useTooltipHost() {
  const popup = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [position, setPosition] = useState<TipPosition>({
    left: 0,
    top: 0,
    arrow: "none",
    offset: 0,
  });
  const timer = useRef(0);
  const target = useRef<HTMLElement | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  /** Close the tip and forget its anchor. */
  const dismiss = () => {
    window.clearTimeout(timer.current);
    target.current = null;
    setTip(null);
  };
  /** Resolve the nearest annotated ancestor and schedule its tip after the dwell. */
  const request = (event: Event, immediate = false) => {
    const candidate =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-tip-title], [data-tip-desc]")
        : null;
    // A modal makes the layers below it inert. Their controls must not publish
    // a tip even if a stray focus or synthetic pointer event reaches them. An
    // engaged trigger owns an open surface, so its tip would cover that surface.
    const next =
      candidate && !candidate.closest("[inert]") && !isEngaged(candidate) ? candidate : null;
    if (target.current === next) {
      return;
    }
    dismiss();
    target.current = next;
    if (next) {
      if (event instanceof PointerEvent) {
        pointer.current = { x: event.clientX, y: event.clientY };
      }
      const show = () => {
        // The annotation can disappear before the dwell elapses (for example
        // when a transient control unmounts).
        if (
          !next.isConnected ||
          isEngaged(next) ||
          (!next.hasAttribute("data-tip-title") && !next.hasAttribute("data-tip-desc"))
        ) {
          return;
        }
        const keys = lookupShortcut(next.dataset.tipAction ?? "", next.dataset.tipEditor);
        setTip({
          anchor: next,
          pointer: { ...pointer.current },
          title: tooltipTitle(next.dataset.tipTitle),
          description: next.dataset.tipDesc ?? "",
          video: next.dataset.tipVideo ?? "",
          strokes:
            keys.length > 0 ? keys : next.dataset.tipKey ? [{ keyLabel: next.dataset.tipKey }] : [],
        });
      };
      if (immediate) {
        show();
      } else {
        // Long hover, not a flicker: the tip is worth waiting for, and a delay
        // this long keeps a pointer crossing the bar from flashing it.
        timer.current = window.setTimeout(show, 420);
      }
    }
  };
  /** Follow the pointer for tips that are placed at the cursor. */
  const track = (event: PointerEvent) => {
    pointer.current = { x: event.clientX, y: event.clientY };
    if (target.current?.closest('[data-tip-placement="pointer"]')) {
      setTip((current) => (current ? { ...current, pointer: { ...pointer.current } } : current));
    }
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismiss();
      }
    };
    const onPointerOver = (event: PointerEvent) => request(event);
    const onPointerMove = (event: PointerEvent) => track(event);
    const onPointerOut = (event: PointerEvent) => {
      const anchor = target.current;
      if (!anchor) {
        return;
      }
      const destination = event.relatedTarget;
      if (!(destination instanceof Node) || !anchor.contains(destination)) {
        dismiss();
      }
    };
    const onFocusIn = (event: FocusEvent) => request(event, true);
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", dismiss);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("scroll", dismiss, true);
    document.documentElement.addEventListener("pointerleave", dismiss);
    window.addEventListener(MODAL_STACK_EVENT, dismiss);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", dismiss);
    return () => {
      dismiss();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", dismiss);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("scroll", dismiss, true);
      document.documentElement.removeEventListener("pointerleave", dismiss);
      window.removeEventListener(MODAL_STACK_EVENT, dismiss);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", dismiss);
    };
    // The listeners bind once; the handlers read refs and the live shortcut
    // lookup, so a later render does not need to replace them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    showTransient = (next) => {
      if (!next) {
        dismiss();
        return;
      }
      window.clearTimeout(timer.current);
      target.current = null;
      setTip({
        anchor: next.anchor,
        title: tooltipTitle(next.title),
        description: next.description ?? "",
        video: "",
        strokes: [],
        pointer: next.pointer,
        placement: "pointer",
      });
    };
    return () => {
      showTransient = null;
    };
  }, []);
  // A trigger can expand while its tip is already visible: focus lands before
  // the click's state update. Dismiss the tip the moment the anchor reports an
  // open surface, so a focus- or hover-triggered tip never covers its panel.
  useEffect(() => {
    const anchor = tip?.anchor;
    if (!anchor) {
      return undefined;
    }
    const observer = new MutationObserver(() => {
      if (isEngaged(anchor)) {
        dismiss();
      }
    });
    observer.observe(anchor, {
      attributes: true,
      attributeFilter: ["aria-expanded", "aria-controls"],
    });
    return () => observer.disconnect();
  }, [tip]);
  useLayoutEffect(() => {
    const node = popup.current;
    if (!node) {
      return;
    }
    if (!tip || !tip.anchor.isConnected) {
      node.hidePopover();
      return;
    }
    const previous = tip.anchor.getAttribute("aria-describedby");
    tip.anchor.setAttribute("aria-describedby", `${previous ?? ""} redux-rich-tooltip`.trim());
    const attached = tip.anchor.classList.contains("redux-action");
    node.showPopover();
    const rect = tip.anchor.getBoundingClientRect();
    // An ancestor may declare where its tips go: `[data-tip-placement="left"]`
    // asks for a tip centred beside a rail that sits against the right edge.
    const placement =
      tip.placement ??
      tip.anchor.closest<HTMLElement>("[data-tip-placement]")?.dataset.tipPlacement;
    // The tooltip hugs the control: 2px off the edge it is attached to.
    const gap = attached ? 2 : 8;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const edge = (extent: number) => Math.max(8, Math.min(14, extent / 2));
    if (placement === "left") {
      const left = clamp(rect.left - width - gap, 8, innerWidth - width - 8);
      const top = clamp(rect.top + (rect.height - height) / 2, 8, innerHeight - height - 8);
      setPosition({
        left,
        top,
        arrow: "right",
        offset: clamp(
          rect.top + rect.height / 2 - top,
          edge(height),
          Math.max(edge(height), height - edge(height)),
        ),
      });
    } else if (placement === "pointer") {
      const point = tip.pointer ?? { x: rect.left, y: rect.bottom };
      setPosition({
        left: clamp(point.x + 14, 8, innerWidth - width - 8),
        top: clamp(point.y + 16, 8, innerHeight - height - 8),
        // A pointer tip is not attached to an edge, so there is nothing to point at.
        arrow: "none",
        offset: 0,
      });
    } else {
      const below = rect.bottom + gap;
      const fits = below + height <= innerHeight - 8;
      const top = clamp(fits ? below : rect.top - height - gap, 8, innerHeight - height - 8);
      const left = clamp(rect.left + (rect.width - width) / 2, 8, innerWidth - width - 8);
      // The arrow tracks the control, not the tip: a tip pushed back inside the
      // window is no longer centred on its button, and an arrow left at the
      // midpoint would point at the wrong thing.
      setPosition({
        left,
        top,
        arrow: fits ? "top" : "bottom",
        offset: clamp(
          rect.left + rect.width / 2 - left,
          edge(width),
          Math.max(edge(width), width - edge(width)),
        ),
      });
    }
    return () => {
      if (previous === null) {
        tip.anchor.removeAttribute("aria-describedby");
      } else {
        tip.anchor.setAttribute("aria-describedby", previous);
      }
    };
  }, [tip]);
  const placement =
    tip?.placement ??
    tip?.anchor.closest<HTMLElement>("[data-tip-placement]")?.dataset.tipPlacement;
  return {
    element: (
      <div
        ref={popup}
        id="redux-rich-tooltip"
        role="tooltip"
        className="redux-rich-tooltip"
        popover="manual"
        data-attached={tip?.anchor.classList.contains("redux-action") ? "true" : "false"}
        data-placement={placement === "left" || placement === "pointer" ? placement : "edge"}
        data-arrow={position.arrow}
        style={
          {
            left: `${position.left}px`,
            top: `${position.top}px`,
            "--tip-arrow-offset": `${position.offset}px`,
          } as CSSProperties
        }
      >
        {Boolean(tip?.title || tip?.strokes.length) && (
          <div className="redux-tip-head">
            {tip?.title && <strong>{tip.title}</strong>}
            {tip?.strokes.length ? <KbdBindings strokes={tip.strokes} /> : null}
          </div>
        )}
        {tip?.video && (
          <video
            className="redux-tip-video"
            src={tip.video}
            muted
            loop
            autoPlay
            playsInline
            preload="metadata"
            aria-hidden="true"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
        )}
        {tip?.description && <p>{tip.description}</p>}
      </div>
    ),
  };
}
