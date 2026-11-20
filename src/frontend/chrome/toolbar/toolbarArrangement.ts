/**
 * The toolbar rows as the user arranged them.
 *
 * The registry is the source of every command; this module is the one place that
 * turns the registry plus the stored arrangement into the ordered entries a row
 * paints. Separating it keeps the row components free of layout rules and gives
 * the editor overlay exactly one function to write back through.
 */
import type {
  ToolbarDivider,
  ToolbarEntry,
  ToolbarRowName,
} from "../../../core/shell/registries/toolbar.ts";
import {
  resolveSurfaceLayout,
  type LayoutArrangement,
  type LayoutSlot,
} from "../../../core/shell/layoutArrangement.ts";

/** The row a registered toolbar entry sits in when the user has not moved it. */
export function authoredRow(entry: ToolbarEntry): ToolbarRowName {
  return entry.row ?? 1;
}

/**
 * The entries a row may draw before the user moves anything.
 *
 * An entry that declares no `row` is not on the toolbar: the registry also carries
 * commands that only exist in menus, panels, and the shortcut table. Filtering here
 * is what keeps a fresh profile identical to the chrome that existed before the
 * layout editor, which appends every id it is told about.
 */
export function authoredRows(entries: readonly ToolbarEntry[]): ToolbarEntry[] {
  return entries.filter((entry) => entry.row !== undefined);
}

/**
 * The registered entries of one row, in the order the user arranged them.
 *
 * A placement that names an entry this profile no longer registers is skipped, so
 * uninstalling an Extension leaves no hole. A rule the user placed becomes a
 * divider entry with the placement's own id.
 */
export function arrangedToolbarRow(
  entries: readonly ToolbarEntry[],
  row: ToolbarRowName,
  arrangement: LayoutArrangement,
): ToolbarEntry[] {
  const drawnEntries = authoredRows(entries);
  const byId = new Map(drawnEntries.map((entry) => [entry.id, entry]));
  const registeredIds = drawnEntries.map((entry) => entry.id);
  const slots = resolveSurfaceLayout(arrangement, "toolbar", registeredIds, (id) =>
    authoredRow(byId.get(id) ?? ({ row: 1 } as ToolbarEntry)),
  );
  const slot = slots.find((candidate) => candidate.slot === row);
  if (!slot) {
    return [];
  }
  const drawn: ToolbarEntry[] = [];
  for (const placement of slot.items) {
    if (placement.divider === true) {
      // A placement can be a rule the user drew, or a rule the product registered
      // for its own group. Both draw the same line; only the id tells them apart.
      const registered = byId.get(placement.id);
      drawn.push(
        registered?.kind === "divider"
          ? registered
          : ({
              kind: "divider",
              id: placement.id,
              order: 0,
              row,
            } satisfies ToolbarDivider),
      );
      continue;
    }
    const entry = byId.get(placement.id);
    if (entry) {
      drawn.push(entry);
    }
  }
  return drawn;
}

/**
 * The arrangement positions a save would write.
 *
 * The editor shows one strip per row; a row the user emptied is kept so the
 * surface still knows it exists when a new command lands in it.
 */
export function arrangementSlots(
  arrangement: LayoutArrangement,
  entries: readonly ToolbarEntry[],
): LayoutSlot[] {
  const drawnEntries = authoredRows(entries);
  const byId = new Map(drawnEntries.map((entry) => [entry.id, entry]));
  return resolveSurfaceLayout(
    arrangement,
    "toolbar",
    drawnEntries.map((entry) => entry.id),
    (id) => authoredRow(byId.get(id) ?? ({ row: 1 } as ToolbarEntry)),
  );
}
