/**
 * The shared sidebar as a two-column icon-and-label grid.
 *
 * This is the inspector's empty state. It renders the same merged inspector and
 * drawer destinations as the rail, in the same order, with their host-owned
 * labels, glyphs, and activation callbacks. Dividers survive only between two
 * visible destinations; leading and trailing separators are dropped, and
 * consecutive separators collapse to one. The grid has no visible caption: the
 * inspector status bar already owns the surface name.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Button } from "../../../../design/components/button/Button.tsx";
import { Divider } from "../../../../design/components/divider/Divider.tsx";
import { Icon, iconName } from "../../../../design/components/icon/Icon.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import { bindDrawerPaneTrigger, closeDrawer } from "../../../chrome/drawer/drawerPanes.ts";
import {
  closeWorkspaceMode,
  useActiveWorkspaceModeId,
} from "../workspace/container/workspaceModes.ts";
import type {
  SidebarNavigationDivider,
  SidebarNavigationEntry,
  SidebarNavigationItem,
} from "../../../chrome/sidebar/navigation.ts";

/** Reads one entry's reactive visibility gate. */
function isEntryVisible(entry: SidebarNavigationEntry): boolean {
  return entry.visibility?.get() ?? true;
}

/**
 * Snapshot key for every entry's visibility, ordered like `entries`.
 *
 * One external-store subscription covers the whole list so registrations can
 * change the entry count without calling a hook conditionally.
 */
function useEntryVisibilityKey(entries: readonly SidebarNavigationEntry[]): string {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const unsubscribers = entries.flatMap((entry) =>
        entry.visibility ? [entry.visibility.subscribe(onStoreChange)] : [],
      );
      return () => {
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
      };
    },
    [entries],
  );
  const getSnapshot = useCallback(
    () => entries.map((entry) => (isEntryVisible(entry) ? "1" : "0")).join(""),
    [entries],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Keeps visible entries in rail order and retains only dividers that separate
 * two visible destinations. A pending divider is flushed by the next visible
 * item, so trailing separators disappear and adjacent separators collapse.
 */
function planVisibleEntries(
  entries: readonly SidebarNavigationEntry[],
  visibilityKey: string,
): SidebarNavigationEntry[] {
  const planned: SidebarNavigationEntry[] = [];
  let pendingDivider: SidebarNavigationDivider | null = null;
  entries.forEach((entry, index) => {
    if (visibilityKey[index] !== "1") {
      return;
    }
    if (entry.kind === "divider") {
      if (planned.length > 0 && pendingDivider === null) {
        pendingDivider = entry;
      }
      return;
    }
    if (pendingDivider !== null) {
      planned.push(pendingDivider);
      pendingDivider = null;
    }
    planned.push(entry);
  });
  return planned;
}

/** One tile, including the entry's glyph and drawer trigger registration. */
function NavigationButton({ item }: { item: SidebarNavigationItem }) {
  const { tRaw } = useTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const activeWorkspaceMode = useActiveWorkspaceModeId();
  useEffect(() => {
    if (!item.drawerPaneId) {
      return;
    }
    return bindDrawerPaneTrigger(item.drawerPaneId, trigger.current);
  }, [item.drawerPaneId]);
  return (
    <Button
      ref={trigger}
      id={item.domId}
      variant="plain"
      iconText
      className="inspector-navigation-item"
      onClick={() => {
        if (item.drawerPaneId === undefined) {
          closeDrawer();
        }
        if (item.panelId !== undefined && activeWorkspaceMode) {
          closeWorkspaceMode();
        }
        item.onActivate();
      }}
    >
      <Icon className="inspector-navigation-item-icon" name={iconName(item.icon)} size={18} />
      <span className="inspector-navigation-item-label">{tRaw(item.label)}</span>
    </Button>
  );
}

/** Two-column tile navigation for the inspector's empty state. */
export function InspectorNavigation({ entries }: { entries: readonly SidebarNavigationEntry[] }) {
  const { t } = useTranslation();
  const visibilityKey = useEntryVisibilityKey(entries);
  const visibleEntries = useMemo(
    () => planVisibleEntries(entries, visibilityKey),
    [entries, visibilityKey],
  );
  if (!visibleEntries.some((entry) => entry.kind === "item")) {
    return <div className="inspector-empty-placeholder">{t("chrome.inspector.empty")}</div>;
  }
  return (
    <nav className="inspector-navigation" aria-label={t("chrome.inspector.panels")}>
      <div className="inspector-navigation-grid">
        {visibleEntries.map((entry) =>
          entry.kind === "divider" ? (
            <Divider axis="x" key={entry.id} />
          ) : (
            <NavigationButton key={entry.id} item={entry} />
          ),
        )}
      </div>
    </nav>
  );
}
