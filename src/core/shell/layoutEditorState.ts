/**
 * The layout editor: one draft the chrome paints while it is open.
 *
 * Exactly one arrangement is painted. Closed, that is the saved document; open,
 * it is the draft, so a gesture shows its result on the real toolbar and rail
 * immediately and 放弃 is just publishing the saved document again. Nothing is
 * written to preferences until 保存.
 *
 * A gesture is tracked here rather than in the overlay because the surfaces that
 * own the pointer — the toolbar rows and the rail — are the ones that see it
 * start, and the overlay that must see it end.
 */
import { createValue } from "../state/values.ts";
import { PREFERENCE_SECTIONS, preferences } from "../state/preferences.ts";
import {
  hidePlacement,
  movePlacement,
  removePlacement,
  resolveSurfaceLayout,
  revealPlacement,
  tidyPlacements,
  withSurfaceLayout,
  type LayoutArrangement,
  type LayoutPlacement,
  type LayoutSurfaceId,
  type LayoutSlot,
  type LayoutSlotId,
} from "./layoutArrangement.ts";
import { commitSurfaceArrangement, currentArrangement } from "./layoutArrangementStore.ts";

/**
 * The arrangement the chrome paints.
 *
 * Every surface subscribes to this one cell, so the toolbar, the rail, and the
 * editor overlay cannot disagree about what is on screen.
 */
export const paintedLayout = createValue<LayoutArrangement>({ initial: {} });

/** Whether the overlay is open. Runtime only: a reopen never resumes a draft. */
export const layoutEditorOpen = createValue<boolean>({ initial: false });

/** The one surface the open editor is arranging. */
export const layoutEditorSurface = createValue<LayoutSurfaceId>({ initial: "toolbar" });

/**
 * What a gesture is carrying.
 *
 * A rule gets its id when the gesture starts, so the preview can place it and the
 * drop can then treat it as an ordinary item; minting it later would make the rule
 * appear, move, and then be replaced by a second one.
 */
export type LayoutDragPayload =
  | { kind: "placed"; id: string; surface: LayoutSurfaceId }
  | { kind: "available"; id: string; surface: LayoutSurfaceId }
  | { kind: "divider"; id: string; surface: LayoutSurfaceId };

/** A gesture in flight, with the pointer that started it. */
export interface LayoutDragState {
  payload: LayoutDragPayload;
  /** Whether the pointer has moved far enough to count as a drag. */
  moving: boolean;
  x: number;
  y: number;
}

/** The gesture in flight, or null. */
export const layoutDrag = createValue<LayoutDragState | null>({ initial: null });

/** Start tracking a gesture the chrome received; the overlay decides the drop. */
export function beginLayoutDrag(payload: LayoutDragPayload, x: number, y: number): void {
  layoutDrag.set({ payload, moving: false, x, y });
}

/** Move the tracked gesture; the first real movement promotes a press to a drag. */
export function trackLayoutDrag(x: number, y: number, threshold: number): void {
  const current = layoutDrag.get();
  if (!current) {
    return;
  }
  const moved = current.moving || Math.abs(x - current.x) + Math.abs(y - current.y) > threshold;
  layoutDrag.set({ ...current, moving: moved, x, y });
}

/** Abandon the gesture without applying it. */
export function cancelLayoutDrag(): void {
  layoutDrag.set(null);
}

/** Whether a save has been applied since the last open, for the caller to commit. */
let pendingCommit = false;

/** Republish the saved document, which is what a fresh profile and a cancel show. */
export function syncPaintedLayout(): void {
  paintedLayout.set(currentArrangement());
}

/**
 * Follow the saved document for the life of the process.
 *
 * The durable preferences arrive from SQLite after the shell has mounted, so the
 * arrangement a browser profile had to show first is not necessarily the one the
 * user saved. While the editor is closed, every adoption and every write repaints;
 * while it is open the draft stays untouched, because the user is editing it.
 */
export function followSavedArrangement(): () => void {
  return preferences.subscribe(PREFERENCE_SECTIONS.layout, () => {
    if (!layoutEditorOpen.get()) {
      syncPaintedLayout();
    }
  });
}

/** The arrangement the chrome is painting right now. */
export function paintedArrangement(): LayoutArrangement {
  return paintedLayout.get();
}

/** Open the editor for one surface on a copy of that surface's saved arrangement. */
export function openLayoutEditor(surface: LayoutSurfaceId): void {
  paintedLayout.set(currentArrangement());
  layoutEditorSurface.set(surface);
  layoutDrag.set(null);
  pendingCommit = false;
  layoutEditorOpen.set(true);
}

/** Close without saving: the saved document is painted again. */
export function cancelLayoutEditor(): void {
  layoutEditorOpen.set(false);
  layoutDrag.set(null);
  paintedLayout.set(currentArrangement());
}

/**
 * Save the open surface and close.
 *
 * Only that surface's preference key is written, so customizing the toolbar
 * never touches the rail document. The strips are tidied once here: a rule only
 * means something between two items, and during a gesture the run is left exactly
 * as the pointer drew it.
 */
export function saveLayoutEditor(): void {
  const surface = layoutEditorSurface.get();
  const painted = paintedArrangement();
  const stored = painted[surface];
  commitSurfaceArrangement(
    surface,
    stored
      ? {
          ...painted,
          [surface]: {
            ...stored,
            slots: stored.slots
              .map((slot) => ({ slot: slot.slot, items: tidyPlacements(slot.items) }))
              .filter((slot) => slot.items.length > 0),
          },
        }
      : painted,
  );
  pendingCommit = true;
  layoutDrag.set(null);
  layoutEditorOpen.set(false);
}

/** Whether the last close was a save, which the opener reports as a confirmation. */
export function consumeSaveOutcome(): boolean {
  const saved = pendingCommit;
  pendingCommit = false;
  return saved;
}

/** Write one surface's strips into the painted draft. */
export function writeSurfaceSlots(surface: LayoutSurfaceId, slots: readonly LayoutSlot[]): void {
  paintedLayout.set(withSurfaceLayout(paintedArrangement(), surface, slots));
}

/** The strips one surface paints, filled in from the registered layout. */
export function surfaceSlots(
  surface: LayoutSurfaceId,
  registeredIds: readonly string[],
  authoredSlot: (id: string) => LayoutSlotId,
): LayoutSlot[] {
  return resolveSurfaceLayout(paintedArrangement(), surface, registeredIds, authoredSlot);
}

/** Move one item inside the painted draft. */
export function moveSurfaceItem(
  surface: LayoutSurfaceId,
  registeredIds: readonly string[],
  authoredSlot: (id: string) => LayoutSlotId,
  id: string,
  slot: LayoutSlotId,
  index: number,
): void {
  writeSurfaceSlots(
    surface,
    movePlacement(surfaceSlots(surface, registeredIds, authoredSlot), id, slot, index),
  );
}

/**
 * Remove one placement from the painted draft.
 *
 * A registered command is recorded as removed as well as dropped from its strip,
 * because the resolver appends registered ids the layout does not name. Without
 * that record the command would come straight back on the next render.
 */
export function removeSurfaceItem(
  surface: LayoutSurfaceId,
  registeredIds: readonly string[],
  authoredSlot: (id: string) => LayoutSlotId,
  id: string,
): void {
  const arrangement = paintedArrangement();
  const known = registeredIds.includes(id);
  paintedLayout.set(
    hidePlacement(
      withSurfaceLayout(
        arrangement,
        surface,
        removePlacement(surfaceSlots(surface, registeredIds, authoredSlot), id),
      ),
      surface,
      known ? id : "",
    ),
  );
}

/** Add a placement at one strip position, clearing any removal recorded for it. */
export function addSurfaceItem(
  surface: LayoutSurfaceId,
  slot: LayoutSlotId,
  placement: LayoutPlacement,
  index: number,
  registeredIds: readonly string[],
  authoredSlot: (id: string) => LayoutSlotId,
): void {
  const revealed = revealPlacement(paintedArrangement(), surface, placement.id);
  const slots = resolveSurfaceLayout(revealed, surface, registeredIds, authoredSlot);
  const target = slots.find((candidate) => candidate.slot === slot) ?? {
    slot,
    items: [] as LayoutPlacement[],
  };
  const items = [...target.items];
  items.splice(Math.max(0, Math.min(index, items.length)), 0, placement);
  const next = slots.some((candidate) => candidate.slot === slot)
    ? slots.map((candidate) => (candidate.slot === slot ? { slot, items } : candidate))
    : [...slots, { slot, items }].sort((left, right) => left.slot - right.slot);
  paintedLayout.set(withSurfaceLayout(revealed, surface, next));
}
