/**
 * Judge-line page: the compact Inspector stack and the expanded line workspace.
 *
 * The tree, selection, bulk fields, texture picker, and folder operations are the
 * same components in both layouts. The compact page stacks tree above form; the
 * workspace shows both columns at full height.
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
 * panel's render lifecycle once for whichever layout is mounted.
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

/** One judge-line page at the compact or workspace layout. */
function LinesPage({ layout }: { layout: "compact" | "workspace" }) {
  useLinePanelBinding();
  return <LinesPanel showTitle={false} variant={layout === "workspace" ? "split" : "stacked"} />;
}

/** The compact page: the tree above the selected line's properties. */
function LinesInspectorPage() {
  return <LinesPage layout="compact" />;
}

/** The expanded workspace with full-height tree/form columns. */
function LinesStudio() {
  return (
    <div className="lines-studio">
      <LinesPage layout="workspace" />
    </div>
  );
}

const mode: WorkspaceModeDefinition = {
  id: "lines",
  order: 30,
  label: "chrome.pane.lines",
  icon: "grid",
  component: LinesStudio,
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
  // The line workspace splits its two faces 0.9fr / 1.1fr, so the compact page
  // settles on the larger property column when it expands.
  modeDetailShare: 0.55,
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
