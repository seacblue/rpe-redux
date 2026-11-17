/**
 * Asset page: the compact Inspector stack and its workspace mode.
 *
 * The same library tree, import actions, preview, shader parameters, and dialogs
 * are the page in every frame. The expanded task is a geometry the same split
 * grows into, not a second page.
 */
import { useEffect, useSyncExternalStore } from "react";
import {
  registerWorkspaceMode,
  type WorkspaceModeDefinition,
} from "../../../editor/workspace/container/workspaceModes.ts";
import { registerInspectorPanel } from "../../../editor/inspector/controller.ts";
import { registerInspectorSidebar } from "../../../editor/inspector/inspectorShell.ts";
import { useInspectorRuntime } from "../../../editor/workspace/runtime/providers/InspectorProvider.tsx";
import { useEditorSession } from "../../../editor/workspace/runtime/providers/SessionProvider.tsx";
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

/** Keeps the library tree synchronized with the installed document session. */
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
    const refresh = (event?: Event): void => {
      const kind = (event as CustomEvent<{ kind?: string }> | undefined)?.detail?.kind;
      if (kind === "selection") {
        return;
      }
      void inspector.assetLibrary.render();
    };
    refresh();
    session.addEventListener("change", refresh);
    return () => session.removeEventListener("change", refresh);
  }, [inspector, session]);
}

/** The compact page: the folder tree above the selected asset's details. */
function AssetsInspectorPage() {
  useAssetLibraryBinding();
  return <AssetsPanel showTitle={false} variant="stacked" />;
}

const mode: WorkspaceModeDefinition = {
  id: "assets",
  order: 40,
  label: "chrome.pane.assets",
  icon: "folder",
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
