/**
 * Middle window seam: the editor workspace, the inspector, and the sidebar rail.
 *
 * The frame renders one surface's slots and names no page. Document-wide pages
 * are an inspector content mode, so this frame never mounts a second surface
 * beside the stage. The theme's sidebar placement may move the rail to a top bar
 * or into the inspector empty state.
 */
import { Sidebar, type SidebarPlacement } from "../chrome/sidebar/Sidebar.tsx";
import "../screens/global/pages.ts";
import { activeSurface } from "./modeRegistry.ts";
import { useThemeChrome } from "./useThemeChrome.ts";
import { useActiveWorkspaceModeId } from "../screens/editor/workspace/container/workspaceModes.ts";

/**
 * Composes the middle window seam. The `atHome` input hides the assembled
 * region without disposing the mounted editor.
 */
export function Workbench({ atHome }: { atHome: boolean }) {
  const surface = activeSurface;
  const chrome = useThemeChrome();
  const workspaceMode = useActiveWorkspaceModeId();
  // Advanced sidebar placements need an inspector to hold the registered
  // entries.
  const canMoveSidebar = surface.inspector !== undefined;
  const requestedSidebar = chrome.layout.sidebar;
  const sidebarPlacement: SidebarPlacement =
    (requestedSidebar === "top" || requestedSidebar === "inspector") && !canMoveSidebar
      ? "rail"
      : requestedSidebar;
  const topSidebar = sidebarPlacement === "top";
  const sidebarInInspector = sidebarPlacement === "inspector";
  const WorkspaceSurface = surface.workspace;
  const InspectorSurface = surface.inspector;

  return (
    <div
      className="workbench"
      hidden={atHome}
      data-sidebar={sidebarPlacement}
      data-workspace-mode={workspaceMode ? "true" : undefined}
    >
      {topSidebar && <Sidebar placement="top" sidebar={surface.sidebar} />}
      <div className="workbench-body">
        <div
          className="workbench-workspace"
          aria-hidden={workspaceMode ? true : undefined}
          inert={workspaceMode ? true : undefined}
        >
          <WorkspaceSurface />
        </div>
        {InspectorSurface && (
          <div className="workbench-inspector">
            <InspectorSurface />
          </div>
        )}
        {!topSidebar && !sidebarInInspector && (
          <Sidebar placement={sidebarPlacement} sidebar={surface.sidebar} />
        )}
      </div>
    </div>
  );
}
