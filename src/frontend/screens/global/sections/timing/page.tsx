/**
 * Timing page: the compact Inspector stack and the expanded timing workspace.
 *
 * Both layouts use the same list and property faces. The compact page stacks
 * them; the workspace places them side by side at full height.
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
import { GlobalTimingWorkspace } from "./GlobalTimingWorkspace.tsx";
import { useGlobalChart } from "../../useGlobalChart.ts";
import { TimingDetectFooter } from "../../../editor/inspector/bpm/BpmPanel.tsx";
import { GLOBAL_PAGE_TUTORIALS } from "../../tutorials.ts";
import { TimingPageLayout } from "./TimingPageLayout.tsx";

const hasDocument = {
  get: () => getEditorVisibility().hasDocument,
  subscribe: subscribeToEditorVisibility,
};

/** The compact page: timing rows above the selected point's properties. */
function TimingInspectorPage() {
  const chart = useGlobalChart();
  if (!chart?.BPMList.length) {
    // With no timing points there is no point property to inspect. Keep the
    // offset/list/add surface full-height, and pin the detector entry below it
    // so the author can still create the first timing.
    return (
      <div className="timing-empty-page">
        <div className="timing-empty-list">
          <GlobalTimingWorkspace />
        </div>
        <TimingDetectFooter disabled={!chart} />
      </div>
    );
  }
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
  label: "chrome.pane.bpm",
  icon: "bpm",
  tutorial: GLOBAL_PAGE_TUTORIALS.timing,
  workspaceMode: "timing",
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
