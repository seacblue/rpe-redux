/**
 * Middle window seam: the editor workspace, the inspector, and the sidebar rail.
 *
 * The frame renders one surface's slots and names no page. Document-wide pages
 * are an inspector content mode, so this frame never mounts a second surface
 * beside the stage. The rail always occupies the window's trailing column; its
 * placement is host-owned rather than a theme choice.
 */
import { Sidebar } from "../chrome/sidebar/Sidebar.tsx";
import "../screens/global/pages.ts";
import { activeSurface } from "./modeRegistry.ts";
import { useActiveWorkspaceModeId } from "../screens/editor/workspace/container/workspaceModes.ts";
import { Splitter } from "../../design/components/splitter/Splitter.tsx";
import { useTranslation } from "../../i18n/react.ts";
import { useLayoutRegion, useViewportSize } from "./layout/useLayoutProportions.ts";

/**
 * Composes the middle window seam. The `atHome` input hides the assembled
 * region without disposing the mounted editor.
 */
export function Workbench({ atHome }: { atHome: boolean }) {
  const { t } = useTranslation();
  const surface = activeSurface;
  const workspaceMode = useActiveWorkspaceModeId();
  const viewport = useViewportSize();
  const inspectorSeam = useLayoutRegion("inspector", viewport);
  const sidebarSeam = useLayoutRegion("sidebar", viewport);
  const WorkspaceSurface = surface.workspace;
  const InspectorSurface = surface.inspector;

  return (
    <div
      className="workbench"
      hidden={atHome}
      data-workspace-mode={workspaceMode ? "true" : undefined}
    >
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
        <Sidebar sidebar={surface.sidebar} />
        <Splitter
          orientation="vertical"
          className="layout-splitter--inspector"
          label={t("chrome.splitter.inspector")}
          value={inspectorSeam.value}
          min={inspectorSeam.min}
          max={inspectorSeam.max}
          defaultValue={inspectorSeam.defaultValue}
          onChange={inspectorSeam.setPixels}
          invert
        />
        <Splitter
          orientation="vertical"
          className="layout-splitter--sidebar"
          label={t("chrome.splitter.sidebar")}
          value={sidebarSeam.value}
          min={sidebarSeam.min}
          max={sidebarSeam.max}
          defaultValue={sidebarSeam.defaultValue}
          onChange={sidebarSeam.setPixels}
          invert
        />
      </div>
    </div>
  );
}
