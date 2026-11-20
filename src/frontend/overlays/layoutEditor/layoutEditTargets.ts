/**
 * Geometry registry for the layout editor.
 *
 * A surface publishes the container it painted plus the ids of the items it drew
 * into it, in DOM order. Every question about "what is under the pointer" is then
 * answered by hit-testing that container's live children, which is what keeps the
 * chrome untouched: no wrapper, no extra attribute on a product component, and no
 * rectangle captured before the strip had scrolled or reflowed.
 */
import type { LayoutSlotId, LayoutSurfaceId } from "../../../core/shell/layoutArrangement.ts";

/** How a strip stacks: the toolbar runs along x, the rail along y. */
export type LayoutStripAxis = "x" | "y";

/** One strip: the container a surface drew, and the ids it drew into it. */
interface LayoutStrip {
  surface: LayoutSurfaceId;
  slot: LayoutSlotId;
  node: HTMLElement;
  axis: LayoutStripAxis;
  ids: readonly string[];
  /** The children that are items; a rail's rules are not draggable. */
  selector: string;
}

const strips = new Map<string, LayoutStrip>();
let paletteNode: HTMLElement | null = null;

/** Key one strip by the surface and slot it belongs to. */
function stripKey(surface: LayoutSurfaceId, slot: LayoutSlotId): string {
  return `${surface}/${slot}`;
}

/**
 * Publish one strip; the returned disposer removes it.
 *
 * `ids` is the order the surface rendered, so the nth item child is `ids[n]`.
 * `selector` names the item children, which lets a rail skip the rules it drew
 * between them without the caller having to filter.
 */
export function registerLayoutStrip(strip: LayoutStrip): () => void {
  const key = stripKey(strip.surface, strip.slot);
  strips.set(key, strip);
  return () => {
    if (strips.get(key) === strip) {
      strips.delete(key);
    }
  };
}

/** Publish the editor's own list, which accepts an item back. */
export function registerLayoutPalette(node: HTMLElement | null): () => void {
  paletteNode = node;
  return () => {
    if (paletteNode === node) {
      paletteNode = null;
    }
  };
}

/** Where a gesture would land. */
export type LayoutDropTarget =
  { kind: "slot"; slot: LayoutSlotId; index: number } | { kind: "palette" } | { kind: "outside" };

/** One item child of a strip, with the id it was drawn for. */
interface StripItem {
  id: string;
  element: HTMLElement;
  index: number;
}

/** The item children of one strip, in the order the surface drew them. */
function stripItems(strip: LayoutStrip): StripItem[] {
  const children = [...strip.node.querySelectorAll<HTMLElement>(strip.selector)];
  const items: StripItem[] = [];
  for (const [index, element] of children.entries()) {
    const id = strip.ids[index];
    if (id !== undefined) {
      items.push({ id, element, index });
    }
  }
  return items;
}

/** Whether a box holds a viewport point. */
function holds(node: Element, x: number, y: number): boolean {
  const rect = node.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** The point along one strip's axis. */
function point(axis: LayoutStripAxis, x: number, y: number): number {
  return axis === "x" ? x : y;
}

/**
 * The index a point implies among the items of one strip.
 *
 * An item is crossed at its midpoint, so the pointer passing the centre of a
 * button is what moves the drop past it. The gesture's own item is left out: it
 * has already been lifted out of the run, and counting it would shift the index
 * by one at the moment the drop applies.
 */
function indexAt(
  strip: LayoutStrip,
  items: readonly StripItem[],
  x: number,
  y: number,
  exclude: string | null,
): number {
  const at = point(strip.axis, x, y);
  let index = 0;
  for (const item of items) {
    if (item.id === exclude) {
      continue;
    }
    const rect = item.element.getBoundingClientRect();
    const middle = strip.axis === "x" ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    if (at > middle) {
      index += 1;
    }
  }
  return index;
}

/** The item under one viewport point, or null. */
export function layoutItemAt(
  surface: LayoutSurfaceId,
  x: number,
  y: number,
): { id: string; slot: LayoutSlotId } | null {
  for (const strip of strips.values()) {
    if (strip.surface !== surface) {
      continue;
    }
    for (const item of stripItems(strip)) {
      if (holds(item.element, x, y)) {
        return { id: item.id, slot: strip.slot };
      }
    }
  }
  return null;
}

/**
 * Resolve the drop target under one viewport point.
 *
 * The editor's own list wins over everything, so an item dragged past the chrome
 * can always be put back. A strip then answers with the index its item midpoints
 * imply. `exclude` is the item the gesture is already carrying.
 */
export function layoutDropTargetAt(
  surface: LayoutSurfaceId,
  x: number,
  y: number,
  exclude: string | null = null,
): LayoutDropTarget {
  if (paletteNode && holds(paletteNode, x, y)) {
    return { kind: "palette" };
  }
  for (const strip of strips.values()) {
    if (strip.surface === surface && holds(strip.node, x, y)) {
      return {
        kind: "slot",
        slot: strip.slot,
        index: indexAt(strip, stripItems(strip), x, y, exclude),
      };
    }
  }
  // A strip clips its own overflow, so an item can sit under the pointer while the
  // strip's box no longer does. The item still names the strip it belongs to.
  for (const strip of strips.values()) {
    if (strip.surface !== surface) {
      continue;
    }
    for (const item of stripItems(strip)) {
      if (item.id !== exclude && holds(item.element, x, y)) {
        return {
          kind: "slot",
          slot: strip.slot,
          index: indexAt(strip, stripItems(strip), x, y, exclude),
        };
      }
    }
  }
  return { kind: "outside" };
}
