/**
 * One merged navigation model for the window's single right-hand rail.
 *
 * Inspector panes and document-wide drawer pages use the same entries, order,
 * active state, and activation path. The sidebar and the inspector's empty-state
 * navigation render this model, so there is no second rail to keep in step.
 */
import { useMemo, useSyncExternalStore } from "react";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../core/edit/state/visibility.ts";
import {
  getSidebarEntries,
  subscribeSidebarEntries,
  type SidebarEntry,
} from "../../../core/shell/registries/sidebar.ts";
import type { ValueCell } from "../../../core/state/values.ts";
import { paintedLayout } from "../../../core/shell/layoutEditorState.ts";
import {
  hasSurfaceLayout,
  resolveSurfaceLayout,
  type LayoutArrangement,
} from "../../../core/shell/layoutArrangement.ts";
import {
  drawerPaneDomId,
  toggleDrawerPane,
  useDrawerPanes,
  useDrawerState,
  type DrawerPaneDefinition,
  type DrawerState,
} from "../drawer/drawerPanes.ts";

/** Reactive visibility shared by registered sidebar entries and drawer pages. */
type NavigationVisibility = Pick<ValueCell<boolean>, "get" | "subscribe">;

/** One clickable destination in the shared rail. */
export interface SidebarNavigationItem {
  kind: "item";
  id: string;
  order: number;
  label: string;
  icon: string;
  domId?: string;
  /** Inspector pane opened by this entry. */
  panelId?: string;
  /** Drawer page opened by this entry. */
  drawerPaneId?: string;
  /** Feature-owned active state for entries that are not inspector panes. */
  active?: NavigationVisibility;
  visibility?: NavigationVisibility;
  indicator?: NavigationVisibility;
  badge?: Pick<ValueCell<number>, "get" | "subscribe">;
  onActivate(): void;
}

/** A separator between navigation groups. */
export interface SidebarNavigationDivider {
  kind: "divider";
  id: string;
  order: number;
  visibility?: NavigationVisibility;
}

/** The rail's ordered items and separators. */
export type SidebarNavigationEntry = SidebarNavigationItem | SidebarNavigationDivider;

/** The merged rail plus the drawer state its drawer entries report. */
export interface SidebarNavigation {
  entries: readonly SidebarNavigationEntry[];
  drawer: DrawerState;
}

/**
 * Merges registered inspector routes with drawer pages into one ordered list.
 *
 * Every entry keeps its registered order, so a document page such as metadata
 * can lead the rail as an inspector route. A separator closes the drawer band
 * after its last page; entries outside either group keep their own order.
 */
export function mergeSidebarNavigation(
  entries: readonly SidebarEntry[],
  panes: readonly DrawerPaneDefinition[],
): SidebarNavigationEntry[] {
  const drawerEntries: SidebarNavigationEntry[] = panes.map((pane) => ({
    kind: "item",
    id: `drawer:${pane.id}`,
    order: pane.order,
    label: pane.label,
    icon: pane.icon,
    domId: drawerPaneDomId(pane.id),
    drawerPaneId: pane.id,
    onActivate: () => toggleDrawerPane(pane.id),
  }));
  const editorEntries: SidebarNavigationEntry[] = entries.map((entry) =>
    "kind" in entry
      ? {
          kind: "divider",
          id: entry.id,
          order: entry.order,
          visibility: entry.visibility,
        }
      : {
          kind: "item",
          id: entry.id,
          order: entry.order,
          label: entry.icon.label,
          icon: entry.icon.name,
          domId: entry.icon.domId,
          panelId: entry.panelId,
          active: entry.icon.active,
          visibility: entry.icon.visibility,
          indicator: entry.icon.indicator,
          badge: entry.icon.badge,
          onActivate: entry.onActivate,
        },
  );
  const merged = [...drawerEntries, ...editorEntries];
  if (drawerEntries.length && editorEntries.length) {
    const lastDrawer = Math.max(...drawerEntries.map((entry) => entry.order));
    merged.push({
      kind: "divider",
      id: "drawer.boundary",
      order: lastDrawer + 0.5,
    });
  }
  return merged.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

/**
 * Applies the user's rail arrangement to the merged navigation.
 *
 * The arrangement decides order and where the user put a rule; an item it does
 * not name keeps the authored position, so a newly contributed route still
 * appears. Drawer pages are ordinary items here, which is what lets the rail be
 * reordered as one list.
 */
export function arrangedSidebarNavigation(
  entries: readonly SidebarNavigationEntry[],
  arrangement: LayoutArrangement,
): SidebarNavigationEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const registeredIds = entries.map((entry) => entry.id);
  const slots = resolveSurfaceLayout(arrangement, "sidebar", registeredIds, authoredRailSlot);
  const ordered: SidebarNavigationEntry[] = [];
  for (const slot of slots) {
    for (const placement of slot.items) {
      if (placement.divider === true) {
        ordered.push({ kind: "divider", id: placement.id, order: 0 });
        continue;
      }
      const entry = byId.get(placement.id);
      if (entry) {
        ordered.push(entry);
      }
    }
  }
  return ordered;
}

/** The rail is one column, so every authored entry sits in slot one. */
function authoredRailSlot(): 1 {
  return 1;
}

/** Reads the live merged rail; drawer pages hidden without a document are omitted. */
export function useSidebarNavigation(): SidebarNavigation {
  const entries = useSyncExternalStore(
    subscribeSidebarEntries,
    getSidebarEntries,
    getSidebarEntries,
  );
  const panes = useDrawerPanes();
  const visibility = useSyncExternalStore(
    subscribeToEditorVisibility,
    getEditorVisibility,
    getEditorVisibility,
  );
  const drawer = useDrawerState();
  const merged = useMemo(
    () =>
      mergeSidebarNavigation(
        entries,
        panes.filter((pane) => !pane.requiresDocument || visibility.hasDocument),
      ),
    [entries, panes, visibility.hasDocument],
  );
  const arrangement = useSyncExternalStore(
    paintedLayout.subscribe,
    paintedLayout.get,
    paintedLayout.get,
  );
  const arranged = useMemo(
    () =>
      hasSurfaceLayout(arrangement, "sidebar")
        ? arrangedSidebarNavigation(merged, arrangement)
        : merged,
    [merged, arrangement],
  );
  return { entries: arranged, drawer };
}
