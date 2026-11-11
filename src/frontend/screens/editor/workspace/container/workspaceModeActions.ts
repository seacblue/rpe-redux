/**
 * Space migration between a compact Inspector page and its expanded panel.
 *
 * Expanding a page promotes the inspector into the wide task surface and keeps
 * the compact page mounted as an inert underlay for the crossfade; returning
 * restores input and visibility to that page. Both paths keep the single mode
 * record in `workspaceModes.ts` authoritative.
 */
import type { EditorRuntime } from "../runtime/composition/EditorRuntime.tsx";
import { closeWorkspaceMode, openWorkspaceMode } from "./workspaceModes.ts";
import { openInspector } from "../../inspector/controller.ts";

/**
 * Expands one inspector page into its wide panel.
 *
 * The compact pane stays mounted behind the expanded surface so its layout can
 * crossfade into the studio instead of swapping at full width. Its id is
 * remembered for the return trip. An unknown mode leaves the inspector
 * untouched.
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
