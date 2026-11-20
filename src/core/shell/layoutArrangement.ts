/**
 * A user-authored arrangement of the workspace chrome.
 *
 * The registry stays the source of every command; this module holds only the
 * user's arrangement of the registered ids: which row or column an item sits in,
 * in what order, and where the user put a rule. A missing entry means "use the
 * authored position", so a fresh profile and a newly installed Extension both
 * land where their author put them until the user moves them.
 *
 * The arrangement is stored as a list rather than as per-entry order numbers: a
 * drag rewrites the list, and one list is what the editor overlay shows, what the
 * toolbar reads, and what a save writes.
 */

/** The surface a placement arranges. */
export type LayoutSurfaceId = "toolbar" | "sidebar";

/** A row of the toolbar, or the one column of the rail. */
export type LayoutSlotId = 1 | 2;

/** One placed item: a registered entry, or a rule the user added. */
export interface LayoutPlacement {
  /** The registered entry id, or the rule's own id. */
  id: string;
  /** A rule the user added rather than a registered entry. */
  divider?: true;
}

/** Which strip a placement sits in, in order. */
export interface LayoutSlot {
  slot: LayoutSlotId;
  items: LayoutPlacement[];
}

/** One surface's arrangement, in the order its strips appear. */
export interface SurfaceLayout {
  slots: readonly LayoutSlot[];
  /**
   * Registered ids the user removed on purpose.
   *
   * Without this list a removal cannot stick: the resolver appends every
   * registered command the layout does not name, which is what lets a newly
   * installed package appear. A hidden id is the one exception to that rule.
   */
  hidden: readonly string[];
}

/** Every surface the user has arranged. An absent key means "as authored". */
export type LayoutArrangement = Partial<Record<LayoutSurfaceId, SurfaceLayout>>;

/** The strips one surface shows when the user has not changed anything. */
export const DEFAULT_SLOTS: Readonly<Record<LayoutSurfaceId, readonly LayoutSlotId[]>> =
  Object.freeze({
    toolbar: Object.freeze([1, 2]) as readonly LayoutSlotId[],
    sidebar: Object.freeze([1]) as readonly LayoutSlotId[],
  });

/**
 * Read the arrangement from a stored value.
 *
 * A malformed document is discarded rather than partially trusted: a placement
 * that names no id cannot be drawn, and a strip list that repeats a slot would
 * duplicate every item in it.
 */
export function readArrangement(value: unknown): LayoutArrangement {
  if (!isRecord(value)) {
    return {};
  }
  const arrangement: LayoutArrangement = {};
  for (const surface of ["toolbar", "sidebar"] as const) {
    const surfaceValue = value[surface];
    if (!isRecord(surfaceValue) || !Array.isArray(surfaceValue.slots)) {
      continue;
    }
    const slots: LayoutSlot[] = [];
    const seenSlots = new Set<number>();
    for (const rawSlot of surfaceValue.slots) {
      if (!isRecord(rawSlot)) {
        continue;
      }
      const slot = rawSlot.slot === 1 || rawSlot.slot === 2 ? rawSlot.slot : undefined;
      if (slot === undefined || seenSlots.has(slot) || !Array.isArray(rawSlot.items)) {
        continue;
      }
      const seenIds = new Set<string>();
      const items: LayoutPlacement[] = [];
      for (const rawItem of rawSlot.items) {
        if (!isRecord(rawItem) || typeof rawItem.id !== "string") {
          continue;
        }
        const id = rawItem.id.trim();
        if (!id || seenIds.has(id)) {
          continue;
        }
        seenIds.add(id);
        items.push(rawItem.divider === true ? { id, divider: true } : { id });
      }
      seenSlots.add(slot);
      slots.push({ slot, items });
    }
    const hidden = readHidden(surfaceValue.hidden);
    if (slots.length || hidden.length) {
      arrangement[surface] = { slots, hidden };
    }
  }
  return arrangement;
}

/** Read the removed ids of one surface, dropping anything malformed. */
function readHidden(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const hidden: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const id = entry.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    hidden.push(id);
  }
  return hidden;
}

/** Whether a stored arrangement says anything about one surface. */
export function hasSurfaceLayout(
  arrangement: LayoutArrangement,
  surface: LayoutSurfaceId,
): boolean {
  const stored = arrangement[surface];
  return (stored?.slots.length ?? 0) > 0 || (stored?.hidden.length ?? 0) > 0;
}

/**
 * The arrangement one surface paints with, filled in from the authored layout.
 *
 * Ordering is the user's when they arranged the surface, and the registered
 * order otherwise. Items the arrangement does not mention (a newly installed
 * command) are appended to the last strip, so nothing a feature registers can go
 * missing just because the user saved an arrangement before it existed.
 */
export function resolveSurfaceLayout(
  arrangement: LayoutArrangement,
  surface: LayoutSurfaceId,
  registeredIds: readonly string[],
  authoredSlot: (id: string) => LayoutSlotId,
): LayoutSlot[] {
  const stored = arrangement[surface];
  const slotIds = new Set<number>();
  if (stored) {
    for (const slot of stored.slots) {
      slotIds.add(slot.slot);
    }
  }
  if (!slotIds.size) {
    for (const slot of DEFAULT_SLOTS[surface]) {
      slotIds.add(slot);
    }
  }
  const placed = new Set<string>();
  const slots: LayoutSlot[] = [...slotIds]
    .sort((left, right) => left - right)
    .map((slot) => ({ slot: slot as LayoutSlotId, items: [] as LayoutPlacement[] }));

  /** The strip a placement belongs in, creating one when the arrangement lost it. */
  const slotFor = (id: LayoutSlotId): LayoutSlot => {
    let found = slots.find((candidate) => candidate.slot === id);
    if (!found) {
      found = { slot: id, items: [] };
      slots.push(found);
      slots.sort((left, right) => left.slot - right.slot);
    }
    return found;
  };

  if (stored) {
    const known = new Set(registeredIds);
    for (const slot of stored.slots) {
      const target = slotFor(slot.slot);
      for (const item of slot.items) {
        if (placed.has(item.id)) {
          continue;
        }
        // Keep what the surface can still draw: a registered command, or a rule
        // the user added themselves. A stale id — a feature's own divider, or a
        // command from an uninstalled package — would otherwise stay in the
        // arrangement forever and show up as an unreadable row.
        if (!known.has(item.id) && !isUserDivider(item)) {
          continue;
        }
        placed.add(item.id);
        target.items.push(item);
      }
    }
  }

  // Anything the arrangement does not name comes from the authored layout, in
  // registered order, so a command that arrives after the user saved still lands
  // where its author put it instead of piling up at the end. An id the user
  // removed is the one exception: it stays off the surface until they add it
  // back, which is what makes a removal survive a reload.
  const hidden = new Set(stored?.hidden ?? []);
  for (const id of registeredIds) {
    if (!placed.has(id) && !hidden.has(id)) {
      placed.add(id);
      slotFor(authoredSlot(id)).items.push({ id });
    }
  }
  return slots.filter((slot) => slot.items.length > 0).map((slot) => ({ ...slot }));
}

/**
 * Apply one surface's strips back into the stored arrangement.
 *
 * The removed-id list is carried through unchanged: writing strips is a
 * rearrangement, not a decision about which commands the user wants.
 */
export function withSurfaceLayout(
  arrangement: LayoutArrangement,
  surface: LayoutSurfaceId,
  slots: readonly LayoutSlot[],
): LayoutArrangement {
  return {
    ...arrangement,
    [surface]: {
      slots: slots
        .map((slot) => ({
          slot: slot.slot,
          items: slot.items.filter((item) => item.id.trim().length > 0),
        }))
        .filter((slot) => slot.items.length > 0),
      hidden: arrangement[surface]?.hidden ?? [],
    },
  };
}

/** Record one registered id as removed, keeping every placement out of its way. */
export function hidePlacement(
  arrangement: LayoutArrangement,
  surface: LayoutSurfaceId,
  id: string,
): LayoutArrangement {
  const current = arrangement[surface];
  const slots = (current?.slots ?? []).map((slot) => ({
    slot: slot.slot,
    items: slot.items.filter((item) => item.id !== id),
  }));
  // A rule the user added is not a registered id, so it has nothing to hide: an
  // empty id would make the list lie about what the surface can offer.
  if (!id.trim()) {
    return { ...arrangement, [surface]: { slots, hidden: current?.hidden ?? [] } };
  }
  const hidden = new Set(current?.hidden ?? []);
  hidden.add(id);
  return {
    ...arrangement,
    [surface]: { slots, hidden: [...hidden] },
  };
}

/** Bring one hidden id back, without choosing a position for it. */
export function revealPlacement(
  arrangement: LayoutArrangement,
  surface: LayoutSurfaceId,
  id: string,
): LayoutArrangement {
  const current = arrangement[surface];
  if (!current?.hidden.includes(id)) {
    return arrangement;
  }
  return {
    ...arrangement,
    [surface]: {
      slots: current.slots,
      hidden: current.hidden.filter((entry) => entry !== id),
    },
  };
}

/** A placement list without the rule that would lead, trail, or double up. */
export function tidyPlacements(items: readonly LayoutPlacement[]): LayoutPlacement[] {
  const tidied: LayoutPlacement[] = [];
  for (const item of items) {
    if (item.divider === true) {
      // A rule belongs between two items; a leading or repeated one is dropped.
      if (tidied.length === 0 || tidied[tidied.length - 1].divider === true) {
        continue;
      }
      tidied.push(item);
      continue;
    }
    tidied.push(item);
  }
  while (tidied.length && tidied[tidied.length - 1].divider === true) {
    tidied.pop();
  }
  return tidied;
}

/**
 * Move one item to a strip position, keeping the rest in order.
 *
 * The run is not tidied here. Tidying drops a rule that has temporarily become
 * leading or trailing, and while a gesture is previewed the rule a user is dragging
 * past would be eaten by the next move instead of surviving it. A save tidies the
 * whole arrangement once, which is where that rule belongs.
 */
export function movePlacement(
  slots: readonly LayoutSlot[],
  id: string,
  targetSlot: LayoutSlotId,
  targetIndex: number,
): LayoutSlot[] {
  const moved = findPlacement(slots, id);
  if (!moved) {
    return [...slots];
  }
  const without = slots.map((slot) => ({
    slot: slot.slot,
    items: slot.items.filter((item) => item.id !== id),
  }));
  const target = without.find((slot) => slot.slot === targetSlot) ?? {
    slot: targetSlot,
    items: [] as LayoutPlacement[],
  };
  const index = Math.max(0, Math.min(targetIndex, target.items.length));
  target.items = [...target.items.slice(0, index), moved.placement, ...target.items.slice(index)];
  const next = without.some((slot) => slot.slot === targetSlot)
    ? without
    : [...without, target].sort((left, right) => left.slot - right.slot);
  return next.filter((slot) => slot.items.length > 0);
}

/** Add a rule at one strip position. */
export function insertDivider(
  slots: readonly LayoutSlot[],
  targetSlot: LayoutSlotId,
  targetIndex: number,
  dividerId: string,
): LayoutSlot[] {
  const target = slots.find((slot) => slot.slot === targetSlot) ?? {
    slot: targetSlot,
    items: [] as LayoutPlacement[],
  };
  const index = Math.max(0, Math.min(targetIndex, target.items.length));
  const items = [
    ...target.items.slice(0, index),
    { id: dividerId, divider: true as const },
    ...target.items.slice(index),
  ];
  const next = slots.some((slot) => slot.slot === targetSlot)
    ? slots.map((slot) => (slot.slot === targetSlot ? { slot: slot.slot, items } : slot))
    : [...slots, { slot: targetSlot, items }].sort((left, right) => left.slot - right.slot);
  return next.map((slot) => ({ slot: slot.slot, items: tidyPlacements(slot.items) }));
}

/** Remove one placement, whether it is an entry or a rule. */
export function removePlacement(slots: readonly LayoutSlot[], id: string): LayoutSlot[] {
  return slots
    .map((slot) => ({
      slot: slot.slot,
      items: tidyPlacements(slot.items.filter((item) => item.id !== id)),
    }))
    .filter((slot) => slot.items.length > 0);
}

/** Find one placement and where it sits. */
export function findPlacement(
  slots: readonly LayoutSlot[],
  id: string,
): { slot: LayoutSlotId; index: number; placement: LayoutPlacement } | null {
  for (const slot of slots) {
    const index = slot.items.findIndex((item) => item.id === id);
    if (index >= 0) {
      return { slot: slot.slot, index, placement: slot.items[index] };
    }
  }
  return null;
}

/** A rule the user added, which carries the id `dividerId()` minted. */
export function isUserDivider(placement: LayoutPlacement): boolean {
  return placement.divider === true && placement.id.startsWith(USER_DIVIDER_PREFIX);
}

/** The prefix every user-added rule id carries. */
export const USER_DIVIDER_PREFIX = "layout.divider.";

/** A fresh id for a rule the user added. */
export function dividerId(): string {
  return `${USER_DIVIDER_PREFIX}${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 7)}`;
}

/** A narrow record check that does not depend on the schema layer. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
