/**
 * Space migration between a compact Inspector page and its expanded panel.
 *
 * Expanding a page promotes the inspector itself into the wide task surface and
 * closes the compact pane; returning restores the pane the author came from if
 * the inspector is still empty. Both paths keep the single mode record in
 * `workspaceModes.ts` authoritative.
 */
import type { EditorRuntime } from "../runtime/composition/EditorRuntime.tsx";
import { closeWorkspaceMode, openWorkspaceMode } from "./workspaceModes.ts";
import { closeInspector, openInspector } from "../../inspector/controller.ts";

/**
 * Expands one inspector page into its wide panel.
 *
 * The pane is closed so the same page never mounts both as an inspector column
 * and as a full workspace. Its id is remembered for the return trip. An unknown
 * mode leaves the inspector untouched.
 */
export function expandWorkspaceMode(id: string, runtime: EditorRuntime | null): boolean {
  const pane = runtime?.ui.activeInspector.get() ?? "";
  if (!openWorkspaceMode(id, pane)) {
    return false;
  }
  if (runtime && pane) {
    closeInspector(runtime.ui.activeInspector);
  }
  return true;
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
