/**
 * Timing page: the compact Inspector stack and the expanded timing workspace.
 *
 * Both layouts use the same list and property faces. The compact page stacks
 * them as a split inspector page; the workspace places them side by side at
 * full height.
 */
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
import { GLOBAL_PAGE_TUTORIALS } from "../../tutorials.ts";
import { TimingPageLayout } from "./TimingPageLayout.tsx";

const hasDocument = {
  get: () => getEditorVisibility().hasDocument,
  subscribe: subscribeToEditorVisibility,
};

/** The compact page: timing rows above the selected point's properties. */
function TimingInspectorPage() {
  return <TimingPageLayout layout="compact" />;
}

/** The expanded workspace: full-height timing list and property faces. */
function TimingStudio() {
  return <TimingPageLayout layout="expanded" />;
}

const mode: WorkspaceModeDefinition = {
  id: "timing",
  order: 20,
  label: "chrome.pane.bpm",
  icon: "bpm",
  component: TimingStudio,
  requiresDocument: true,
};

const disposePanel = registerInspectorPanel({
  id: "timing",
  component: TimingInspectorPage,
  layout: "split",
  label: "chrome.pane.bpm",
  icon: "bpm",
  tutorial: GLOBAL_PAGE_TUTORIALS.timing,
  workspaceMode: "timing",
  // The timing workspace splits its two faces evenly, so the compact page settles
  // on the right half when it expands.
  modeDetailShare: 0.5,
  editsChart: true,
});

const disposeSidebar = registerInspectorSidebar({
  id: "timing",
  order: 20,
  panelId: "timing",
  icon: "bpm",
  label: "chrome.pane.bpm",
  domId: "timing-pane",
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
