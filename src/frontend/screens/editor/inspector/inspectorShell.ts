/**
 * Shell contributions for an Inspector are deliberately independent.
 *
 * A panel owns the open capability in `controller.ts`. A tool action or a
 * sidebar button only keeps the panel id and calls `openPane(id)` when used;
 * neither contribution owns or wraps the panel registration. Feature modules
 * register the three surfaces separately and release their cleanup only at the
 * feature's HMR/lifetime layer.
 */
import type { IconName } from "../../../../design/components/icon/Icon.tsx";
import type { MessageKey } from "../../../../i18n/index.ts";
import { toolbar } from "../../../../core/shell/registries/toolbar.ts";
import { registerSidebarItem } from "../../../../core/shell/registries/sidebar.ts";
import type { SidebarItem } from "../../../../core/shell/registries/sidebar.ts";
import { openPane } from "./controller.ts";
import { getEditorVisibility } from "../../../../core/edit/state/visibility.ts";
import type { ValueCell } from "../../../../core/state/values.ts";

/** The action that opens the pane, and the row it shows. */
export interface InspectorToolDefinition {
  /** The action id, kept stable: contexts, shortcuts and suites address it. */
  id: string;
  /** The panel capability opened when the action runs. */
  panelId: string;
  /** The action's place in the Inspector tool group. */
  order: number;
  label: MessageKey;
  icon: IconName;
  /** Start a new visual group in the tools list without changing the action id. */
  separatorBefore?: boolean;
}

/** The sidebar route that opens an already registered panel. */
export interface InspectorSidebarDefinition {
  id: string;
  order: number;
  panelId: string;
  icon: IconName;
  label: MessageKey;
  /** The button's element id for browser automation and accessibility tooling. */
  domId?: string;
  visibility?: Pick<ValueCell<boolean>, "get" | "subscribe">;
  indicator?: Pick<ValueCell<boolean>, "get" | "subscribe">;
  badge?: Pick<ValueCell<number>, "get" | "subscribe">;
}

/** Registers a sidebar route through the host-owned sidebar descriptor. */
export function registerInspectorSidebar(definition: InspectorSidebarDefinition): () => void {
  const item: SidebarItem = {
    id: definition.id,
    order: definition.order,
    panelId: definition.panelId,
    icon: {
      name: definition.icon,
      label: definition.label,
      domId: definition.domId,
      visibility: definition.visibility,
      indicator: definition.indicator,
      badge: definition.badge,
    },
    onActivate: () => {
      openPane(definition.panelId);
    },
  };
  return registerSidebarItem(item);
}

/** Registers a tool action that reserves an independent route to a panel. */
export function registerInspectorTool(definition: InspectorToolDefinition): () => void {
  return toolbar.register({
    kind: "action",
    id: definition.id,
    group: "editor",
    order: definition.order,
    label: definition.label,
    icon: definition.icon,
    tooltip: definition.label,
    separatorBefore: definition.separatorBefore,
    // The panel's primary control is the sidebar button, so no toolbar row draws it.
    toolbar: false,
    run: () => {
      openPane(definition.panelId);
    },
    enabled: () => {
      const visibility = getEditorVisibility();
      return visibility.hasDocument && !visibility.atHome;
    },
  });
}
