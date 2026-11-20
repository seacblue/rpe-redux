/**
 * Pointer capture for one real chrome surface while the layout editor is open.
 *
 * The toolbar rows and the rail arrange themselves; nothing is wrapped, because an
 * extra element between a strip and its items breaks the child selectors that give
 * a toolbar cell its width and a rail row its height. Each surface instead
 * publishes the container it drew plus the ids it drew into it, and takes the
 * pointer at that container.
 *
 * The items keep their pointer events, because hover, the shared tooltip, and the
 * wheel all ride on them. What the editor removes is the effect of a press: the
 * capture listener on the container cancels the click and the context menu it would
 * have raised, so no command runs and no field takes an edit while the surface is
 * being arranged.
 */
import { useEffect, useLayoutEffect, type RefObject } from "react";
import type { LayoutSlotId, LayoutSurfaceId } from "../../../core/shell/layoutArrangement.ts";
import { beginLayoutDrag } from "../../../core/shell/layoutEditorState.ts";
import {
  layoutItemAt,
  registerLayoutStrip,
  type LayoutStripAxis,
} from "../../overlays/layoutEditor/layoutEditTargets.ts";

/** The events a chrome control would act on, cancelled while arranging. */
const INERT_EVENTS = ["click", "auxclick", "dblclick", "submit"] as const;

/**
 * Publish one strip and take its pointer gestures.
 *
 * `ids` is the order the surface rendered, so the nth item child is `ids[n]`;
 * `selector` names those children, which lets a rail skip the rules it drew between
 * them. Both are read again on every hit test, so a strip that scrolled or reflowed
 * is answered from what is on screen.
 */
export function useLayoutEditSurface({
  surface,
  slot,
  axis,
  ids,
  selector,
  active,
  container,
}: {
  surface: LayoutSurfaceId;
  slot: LayoutSlotId;
  axis: LayoutStripAxis;
  ids: readonly string[];
  /** The CSS selector matching the item children inside `container`. */
  selector: string;
  active: boolean;
  container: RefObject<HTMLElement | null>;
}): void {
  const signature = ids.join("\u0000");
  useLayoutEffect(() => {
    const node = container.current;
    if (!active || !node) {
      return undefined;
    }
    return registerLayoutStrip({ surface, slot, node, axis, ids, selector });
  }, [active, surface, slot, axis, signature, selector, container]);

  useEffect(() => {
    const node = container.current;
    if (!active || !node) {
      return undefined;
    }

    /** Take the press when it lands on an item. */
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      const item = layoutItemAt(surface, event.clientX, event.clientY);
      if (!item) {
        return;
      }
      event.preventDefault();
      beginLayoutDrag({ kind: "placed", id: item.id, surface }, event.clientX, event.clientY);
    };

    /** Refuse every action a chrome control would take while it is being arranged. */
    const refuse = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    node.addEventListener("pointerdown", onPointerDown, true);
    for (const type of INERT_EVENTS) {
      node.addEventListener(type, refuse, true);
    }
    return () => {
      node.removeEventListener("pointerdown", onPointerDown, true);
      for (const type of INERT_EVENTS) {
        node.removeEventListener(type, refuse, true);
      }
    };
  }, [active, surface, axis, container]);
}
