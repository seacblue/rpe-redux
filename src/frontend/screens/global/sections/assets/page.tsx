/**
 * Asset page: the compact Inspector stack and the expanded asset workspace.
 *
 * The same library tree, import actions, preview, shader parameters, and dialogs
 * serve both layouts. The workspace only gives the tree and the preview more
 * room; it does not fork asset behavior.
 */
import { useEffect, useSyncExternalStore } from "react";
import { useEditorSession } from "../../../editor/workspace/runtime/providers/SessionProvider.tsx";
import { useInspectorRuntime } from "../../../editor/workspace/runtime/providers/InspectorProvider.tsx";
import {
  registerWorkspaceMode,
  type WorkspaceModeDefinition,
} from "../../../editor/workspace/container/workspaceModes.ts";
import { registerInspectorPanel } from "../../../editor/inspector/controller.ts";
import { registerInspectorSidebar } from "../../../editor/inspector/inspectorShell.ts";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../../../core/edit/state/visibility.ts";
import { AssetsPanel } from "./AssetsPanel.tsx";
import { GLOBAL_PAGE_TUTORIALS } from "../../tutorials.ts";

const hasDocument = {
  get: () => getEditorVisibility().hasDocument,
  subscribe: subscribeToEditorVisibility,
};

/** Builds the library once for each installed document and layout. */
function useAssetLibraryBinding() {
  const inspector = useInspectorRuntime();
  const sessionRuntime = useEditorSession();
  const session = useSyncExternalStore(
    sessionRuntime.subscribe,
    () => sessionRuntime.current,
    () => sessionRuntime.current,
  );
  useEffect(() => {
    if (!inspector) {
      return;
    }
    void inspector.assetLibrary.render();
  }, [inspector, session]);
}

/** One asset page at the compact or workspace layout. */
function AssetsPage({ layout }: { layout: "compact" | "workspace" }) {
  useAssetLibraryBinding();
  return <AssetsPanel showTitle={false} variant={layout === "workspace" ? "split" : "stacked"} />;
}

/** The compact page: the folder tree above the selected asset's details. */
function AssetsInspectorPage() {
  return <AssetsPage layout="compact" />;
}

/** The expanded workspace with full-height tree/preview columns. */
function AssetsStudio() {
  return (
    <div className="assets-studio">
      <AssetsPage layout="workspace" />
    </div>
  );
}

const mode: WorkspaceModeDefinition = {
  id: "assets",
  order: 40,
  label: "chrome.pane.assets",
  icon: "folder",
  component: AssetsStudio,
  requiresDocument: true,
};

const disposePanel = registerInspectorPanel({
  id: "assets",
  component: AssetsInspectorPage,
  layout: "split",
  label: "chrome.pane.assets",
  icon: "folder",
  tutorial: GLOBAL_PAGE_TUTORIALS.assets,
  workspaceMode: "assets",
  // The asset workspace splits its two faces 0.9fr / 1.1fr, so the compact page
  // settles on the larger details column when it expands.
  modeDetailShare: 0.55,
  editsChart: true,
});

const disposeSidebar = registerInspectorSidebar({
  id: "assets",
  order: 40,
  panelId: "assets",
  icon: "folder",
  label: "chrome.pane.assets",
  domId: "assets-pane",
  visibility: hasDocument,
});

const disposeMode = registerWorkspaceMode(mode);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeMode();
    disposeSidebar();
    disposePanel();
  });
}
