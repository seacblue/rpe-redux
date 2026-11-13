/**
 * Judge-line page: the compact Inspector stack and its workspace mode.
 *
 * The tree, selection, bulk fields, texture picker, and folder operations are
 * the same components in every frame. The expanded task is a geometry the same
 * split grows into, not a second page.
 */
import { useEffect, useSyncExternalStore } from "react";
import {
  useEditorRuntime,
  useEditorRuntimeValue,
} from "../../../editor/workspace/runtime/composition/EditorRuntime.tsx";
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
import { LinesPanel } from "./LinesPanel.tsx";
import type { LinePanelSnapshot } from "./model.ts";
import { GLOBAL_PAGE_TUTORIALS } from "../../tutorials.ts";

const hasDocument = {
  get: () => getEditorVisibility().hasDocument,
  subscribe: subscribeToEditorVisibility,
};

/**
 * Keeps the line-panel snapshot bound to the installed session.
 *
 * The tree and form are two faces of one panel instance, so the page runs the
 * panel's render lifecycle once, on the instance that morphs into the task.
 */
function useLinePanelBinding(): LinePanelSnapshot | null {
  const runtime = useEditorRuntime();
  const inspector = useInspectorRuntime();
  const sessionRuntime = useEditorSession();
  const linePanel = useEditorRuntimeValue(
    (current) => current.ui.linePanel,
    null as LinePanelSnapshot | null,
  );
  const session = useSyncExternalStore(
    sessionRuntime.subscribe,
    () => sessionRuntime.current,
    () => sessionRuntime.current,
  );
  useEffect(() => {
    if (!runtime || !inspector) {
      return;
    }
    let frame = 0;
    const render = () => inspector.linePanel.render();
    const schedule = () => {
      if (frame) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        render();
      });
    };
    render();
    session.addEventListener("change", schedule);
    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      session.removeEventListener("change", schedule);
    };
  }, [runtime, inspector, session]);
  return linePanel;
}

/** The compact page: the tree above the selected line's properties. */
function LinesInspectorPage() {
  useLinePanelBinding();
  return <LinesPanel showTitle={false} variant="stacked" />;
}

const mode: WorkspaceModeDefinition = {
  id: "lines",
  order: 30,
  label: "chrome.pane.lines",
  icon: "grid",
  requiresDocument: true,
};

const disposePanel = registerInspectorPanel({
  id: "lines",
  component: LinesInspectorPage,
  layout: "split",
  label: "chrome.pane.lines",
  icon: "grid",
  tutorial: GLOBAL_PAGE_TUTORIALS.lines,
  workspaceMode: "lines",
  editsChart: true,
});

const disposeSidebar = registerInspectorSidebar({
  id: "lines",
  order: 30,
  panelId: "lines",
  icon: "grid",
  label: "chrome.pane.lines",
  domId: "lines-pane",
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
