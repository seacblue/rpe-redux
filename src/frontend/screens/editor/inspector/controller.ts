/**
 * Inspector pane capability registry.
 *
 * Panes register a stable id, their component, and an optional whole-entry
 * `open` override; every surface opens a pane through that id, so no central
 * list of built-in panes exists and lifecycle hooks stay per pane. Drawer pages
 * and inspector panes share one body, so every activation leaves drawer mode
 * before it shows a pane.
 */
import type { ComponentType } from "react";
import type { ValueCell } from "../../../../core/state/values.ts";
import { createValue } from "../../../../core/state/values.ts";
import { OPEN_INSPECTOR_EVENT } from "../../../../core/shell/shellEventNames.ts";
import type { IconName } from "../../../../design/components/icon/Icon.tsx";
import type { MessageKey } from "../../../../i18n/index.ts";
import { closeDrawer } from "../../../chrome/drawer/drawerPanes.ts";
import {
  registerHelpTutorial,
  type HelpTutorialDefinition,
} from "../../../../core/help/tutorialRegistry.ts";

export interface InspectorPanelDefinition {
  id: string;
  component: ComponentType;
  /**
   * How the pane fills the inspector body.
   *
   * `"scroll"` (the default) wraps the pane in one full-bleed scroll region and
   * one content layer. `"split"` declares that the pane renders its own split
   * page (two scroll regions and two content layers), so the frame hands it the
   * body without a wrapper.
   */
  layout?: "scroll" | "split";
  /**
   * The pane name shown in the inspector status bar.
   *
   * Optional so panels registered outside the built-in inspector tree keep
   * compiling; the status bar falls back to the pane's sidebar route label.
   */
  label?: MessageKey;
  /**
   * The glyph shown before the pane name.
   *
   * Optional for Extension-owned panels. The status bar falls back to the
   * sidebar route's icon and then to a generic inspector glyph.
   */
  icon?: IconName;
  /**
   * What opening this pane means, when a switch is not enough.
   *
   * Left out, opening the pane is `openInspector(id)`. A pane that has to prepare
   * something first — materialize its assets, close the tool it takes over from —
   * declares the whole entry point here, and every surface that opens a pane goes
   * through `openPane`. Tools commands and sidebar controls may call `openPane(id)`
   * independently; this contract stays panel-only.
   */
  open?(): void;
  /** The panel-owned walkthrough shown by its header help action. */
  tutorial?: HelpTutorialDefinition;
  /**
   * The wide Inspector mode this page expands into.
   *
   * Set only for large pages: the header then offers a single explicit expansion
   * action that grows the inspector over the workspace.
   */
  workspaceMode?: string;
  /**
   * The share of the expanded page width taken by the page's detail column.
   *
   * Only split pages that also declare a `workspaceMode` hand their lower face
   * over to that column, so they must state the column's share here. It has to
   * equal the detail track of the wide page (for example `0.55` for a
   * `0.9fr 1.1fr` split); the inspector reads it as `--mode-detail-share` to size
   * the compact copy during the expansion and collapse.
   */
  modeDetailShare?: number;
  /**
   * Whether the pane holds chart-editing controls.
   *
   * Read-only documents keep the pane visible but make its body inert, so an
   * inspector field cannot start an edit the session would refuse.
   */
  editsChart?: boolean;
}

/** Lifecycle hooks a feature binds to one pane id. */
export interface InspectorLifecycle {
  onOpen?(): void;
  onClose?(): void;
}

/** Every registered pane, in registration order. */
export const inspectorPanels = createValue<readonly InspectorPanelDefinition[]>({ initial: [] });
const lifecycles = new Map<string, Set<InspectorLifecycle>>();

/** Registers the panel capability; shell surfaces may open it by its stable id. */
export function registerInspectorPanel(definition: InspectorPanelDefinition): () => void {
  if (!definition.id.trim() || inspectorPanels.get().some(({ id }) => id === definition.id)) {
    throw new Error(`Inspector panel id must be unique and nonempty: ${definition.id}`);
  }
  const disposeTutorial = definition.tutorial
    ? registerHelpTutorial(definition.tutorial)
    : undefined;
  inspectorPanels.set([...inspectorPanels.get(), definition]);
  return () => {
    if (!inspectorPanels.get().includes(definition)) {
      return;
    }
    disposeTutorial?.();
    inspectorPanels.set(inspectorPanels.get().filter((entry) => entry !== definition));
  };
}

/** Features supply lifecycle behavior; switching never checks a built-in panel name. */
export function bindInspectorLifecycle(id: string, lifecycle: InspectorLifecycle): () => void {
  let group = lifecycles.get(id);
  if (!group) {
    group = new Set();
    lifecycles.set(id, group);
  }
  group.add(lifecycle);
  return () => {
    group.delete(lifecycle);
    if (!group.size) {
      lifecycles.delete(id);
    }
  };
}

/**
 * Leaves drawer mode so the inspector can show a pane.
 *
 * A drawer page and a pane are two content modes of the same body, never two
 * visible surfaces. Both public activation entries call this after resolving a
 * pane id, so a menu, Extension, collaboration, shortcut, or programmatic open
 * cannot select a pane that the open drawer keeps hidden. Closing an already
 * closed drawer is a no-op and keeps its remembered page.
 */
function leaveDrawerForPane(): void {
  closeDrawer();
}

/**
 * Opens a pane by id, through the entry point that pane declares.
 *
 * The rail button and an action arrive here, so a pane opens the same way from
 * both surfaces, and a pane that needs preparation is prepared once rather than
 * in each surface that offers it. The drawer yields first even when the pane
 * prepares itself through its own `open` entry point.
 */
export function openPane(id: string, state?: ValueCell<string>): boolean {
  const panel = inspectorPanels.get().find((entry) => entry.id === id);
  if (!panel) {
    return false;
  }
  leaveDrawerForPane();
  if (panel.open) {
    panel.open();
    return true;
  }
  return openInspector(id, state);
}

/**
 * Makes one pane the active inspector, leaving drawer mode, without running its
 * `open` entry point.
 */
export function openInspector(id: string, state?: ValueCell<string>): boolean {
  if (!inspectorPanels.get().some((entry) => entry.id === id)) {
    return false;
  }
  leaveDrawerForPane();
  if (!state) {
    window.dispatchEvent(new CustomEvent<string>(OPEN_INSPECTOR_EVENT, { detail: id }));
    return true;
  }
  if (state.get() !== id) {
    closeInspector(state);
    state.set(id);
  }
  for (const lifecycle of [...(lifecycles.get(id) ?? [])]) {
    lifecycle.onOpen?.();
  }
  return true;
}

/** Clears the active pane and runs the closing lifecycle of the previous one. */
export function closeInspector(state: ValueCell<string>): void {
  const previous = state.get();
  state.set("");
  for (const lifecycle of [...(lifecycles.get(previous) ?? [])]) {
    lifecycle.onClose?.();
  }
}
