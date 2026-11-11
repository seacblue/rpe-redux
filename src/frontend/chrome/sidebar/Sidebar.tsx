/**
 * Sidebar rail at the window's right edge, beside the inspector.
 *
 * The rail is the window's only navigation surface. Inspector panes and
 * document-wide drawer pages share one ordered entry list from
 * `navigation.ts`; every route replaces the inspector's content. Drawer pages
 * are the inspector's drawer mode, not a second surface beside it.
 *
 * The rail is permanently compact: it never widens over the inspector, and each
 * entry reveals its name through the shared tooltip layer. Its placement is
 * host-owned, so a theme cannot turn it into a top bar or move it into the
 * inspector.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Divider } from "../../../design/components/divider/Divider.tsx";
import { iconName } from "../../../design/components/icon/Icon.tsx";
import { ThemeRailItem } from "./ThemeRailItem.tsx";
import { bindDrawerPaneTrigger, type DrawerState } from "../drawer/drawerPanes.ts";
import { useTranslation } from "../../../i18n/react.ts";
import type { MessageKey } from "../../../i18n/index.ts";
import { useEditorHostValue } from "../../contracts/editorHostReact.tsx";
import { onboardingAnchorRef } from "../../onboarding/anchors.ts";
import {
  useSidebarNavigation,
  type SidebarNavigationDivider,
  type SidebarNavigationItem,
} from "./navigation.ts";

/** The rail semantics supplied by the active authoring surface. */
export interface SidebarDescriptor {
  /** Accessible name for the rail. */
  label: MessageKey;
  /** Tool rails use toolbar semantics; page navigation uses navigation. */
  role: "toolbar" | "navigation";
}

const neverSubscribe = () => () => {};
const inactive = () => false;
const noBadge = () => 0;
const alwaysVisible = () => true;

/** One rail entry, including its reactive visibility and active state. */
function SidebarEntry({
  item,
  expanded,
  drawer,
}: {
  item: SidebarNavigationItem;
  /** The top bar keeps its labels visible; the rail relies on tooltips. */
  expanded: boolean;
  drawer: DrawerState;
}) {
  const { tRaw } = useTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const activePanel = useEditorHostValue((runtime) => runtime.ui.activeInspector, "");
  useEffect(() => {
    if (!item.drawerPaneId) {
      return;
    }
    return bindDrawerPaneTrigger(item.drawerPaneId, trigger.current);
  }, [item.drawerPaneId]);
  const featureActive = useSyncExternalStore(
    item.active?.subscribe ?? neverSubscribe,
    item.active?.get ?? inactive,
    item.active?.get ?? inactive,
  );
  const visible = useSyncExternalStore(
    item.visibility?.subscribe ?? neverSubscribe,
    item.visibility?.get ?? alwaysVisible,
    item.visibility?.get ?? alwaysVisible,
  );
  const indicator = useSyncExternalStore(
    item.indicator?.subscribe ?? neverSubscribe,
    item.indicator?.get ?? inactive,
    item.indicator?.get ?? inactive,
  );
  const badge = useSyncExternalStore(
    item.badge?.subscribe ?? neverSubscribe,
    item.badge?.get ?? noBadge,
    item.badge?.get ?? noBadge,
  );
  if (!visible) {
    return null;
  }
  // The drawer owns the active state while it is open; otherwise the inspector
  // pane and feature-owned state decide. A hidden inspector never lights up a
  // second entry behind the drawer.
  const active = drawer.open
    ? item.drawerPaneId !== undefined && drawer.pane === item.drawerPaneId
    : item.drawerPaneId === undefined &&
      (featureActive || (item.panelId !== undefined && activePanel === item.panelId));
  return (
    <div className="sidebar-item">
      <ThemeRailItem
        id={item.domId}
        elementRef={trigger}
        label={tRaw(item.label)}
        icon={iconName(item.icon)}
        selected={active}
        expanded={expanded}
        tooltip={!expanded}
        statusDot={indicator}
        data-pane={item.drawerPaneId === undefined ? (item.panelId ?? item.id) : undefined}
        data-drawer-pane={item.drawerPaneId}
        onClick={item.onActivate}
      />
      {badge > 0 && (
        <span className="redux-sidebar-badge" aria-hidden="true">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </div>
  );
}

/** Standalone divider whose visibility can follow its owning group. */
function SidebarRule({ item }: { item: SidebarNavigationDivider }) {
  const visible = useSyncExternalStore(
    item.visibility?.subscribe ?? neverSubscribe,
    item.visibility?.get ?? alwaysVisible,
    item.visibility?.get ?? alwaysVisible,
  );
  return visible ? <Divider axis="x" /> : null;
}

/**
 * Renders the merged inspector and drawer navigation in the window's trailing
 * column.
 */
export function Sidebar({ sidebar }: { sidebar: SidebarDescriptor }) {
  const { t } = useTranslation();
  const { entries, drawer } = useSidebarNavigation();
  const anchor = onboardingAnchorRef("sidebar");
  return (
    <aside
      ref={anchor}
      className="sidebar"
      aria-label={t(sidebar.label)}
      data-tip-placement="left"
      role={sidebar.role}
      aria-orientation={sidebar.role === "toolbar" ? "vertical" : undefined}
    >
      <div className="sidebar-content">
        {entries.map((entry) =>
          entry.kind === "divider" ? (
            <SidebarRule item={entry} key={entry.id} />
          ) : (
            <SidebarEntry item={entry} expanded={false} drawer={drawer} key={entry.id} />
          ),
        )}
      </div>
    </aside>
  );
}
