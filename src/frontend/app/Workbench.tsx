/**
 * Middle window seam: the editor workspace, the inspector, and the sidebar rail.
 *
 * The frame renders one surface's slots and names no page. Document-wide pages
 * are an inspector content mode, so this frame never mounts a second surface
 * beside the stage. The rail always occupies the window's trailing column; its
 * placement is host-owned rather than a theme choice.
 */
import { Sidebar } from "../chrome/sidebar/Sidebar.tsx";
import "../screens/global/drawerPanes.ts";
import { activeSurface } from "./modeRegistry.ts";

/**
 * Composes the middle window seam. The `atHome` input hides the assembled
 * region without disposing the mounted editor.
 */
export function Workbench({ atHome }: { atHome: boolean }) {
  const surface = activeSurface;
  const WorkspaceSurface = surface.workspace;
  const InspectorSurface = surface.inspector;

  return (
    <div className="workbench" hidden={atHome}>
      <div className="workbench-body">
        <div className="workbench-workspace">
          <WorkspaceSurface />
        </div>
        {InspectorSurface && (
          <div className="workbench-inspector">
            <InspectorSurface />
          </div>
        )}
        <Sidebar sidebar={surface.sidebar} />
      </div>
    </div>
  );
}
