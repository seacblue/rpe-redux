/**
 * Space migration between a compact Inspector page and its expanded panel.
 *
 * Expanding a page promotes the same mounted page into the wide task surface;
 * returning plays the same geometry back. Both paths keep the single mode record
 * in `workspaceModes.ts` authoritative. Routing another pane into the Inspector
 * while a task is open goes through the same registry: a page that owns a mode
 * takes the task over in place, while a plain pane asks the frame to leave the
 * task first. Neither path mounts a second surface.
 */
import type { EditorRuntime } from "../runtime/composition/EditorRuntime.tsx";
import {
  closeWorkspaceMode,
  openWorkspaceMode,
  workspaceModeById,
  type WorkspaceModeDefinition,
} from "./workspaceModes.ts";
import { inspectorPanels, openInspector } from "../../inspector/controller.ts";

/**
 * Expands one inspector page into its wide panel.
 *
 * The page stays mounted and morphs in place, so its fields, scroll offsets, and
 * focus survive the transition. Its pane id is remembered for the return trip.
 * An unknown mode leaves the inspector untouched.
 */
export function expandWorkspaceMode(id: string, runtime: EditorRuntime | null): boolean {
  const pane = runtime?.ui.activeInspector.get() ?? "";
  return openWorkspaceMode(id, pane);
}

/**
 * Returns to the timeline and reopens the pane that expanded into the mode.
 *
 * The pane reopens only when nothing else took over the inspector while the
 * mode was open. A caller that closed the mode through `closeWorkspaceMode`
 * directly, or a document replacement that cleared it, is not rewritten here.
 */
export function collapseWorkspaceMode(runtime: EditorRuntime | null): void {
  const pane = closeWorkspaceMode();
  if (!runtime || !pane || runtime.ui.activeInspector.get() !== "") {
    return;
  }
  openInspector(pane, runtime.ui.activeInspector);
}

/** The Inspector page whose registration names one open mode, or `""`. */
export function workspacePaneForMode(modeId: string): string {
  return inspectorPanels.get().find((entry) => entry.workspaceMode === modeId)?.id ?? "";
}

/**
 * The task mode one Inspector page expands into, if that page has one.
 *
 * A split page names its mode in its registration; a plain pane returns `null`
 * and can never fill the task surface.
 */
export function workspaceModeForPane(paneId: string): WorkspaceModeDefinition | null {
  const panel = inspectorPanels.get().find((entry) => entry.id === paneId);
  return panel?.workspaceMode ? workspaceModeById(panel.workspaceMode) : null;
}

/**
 * Moves the open task onto another page's mode without leaving the surface.
 *
 * The task geometry is already expanded, so the new page renders in the same
 * rectangle and the remembered return pane stays unchanged; only the page, its
 * header label, and the rail highlight change.
 */
export function switchWorkspaceMode(mode: WorkspaceModeDefinition, returnPane: string): boolean {
  return openWorkspaceMode(mode.id, returnPane);
}
