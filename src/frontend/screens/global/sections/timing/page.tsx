/**
 * Timing page: a compact Inspector stack and the expanded timing workspace.
 *
 * Both layouts use the same list, property form, metronome, and auto-detect
 * entry. The compact page stacks them so the timeline stays visible; the
 * workspace adds the full-height list and the BPM band map.
 */
import { useTranslation } from "../../../../../i18n/react.ts";
import { InspectorPageSplit } from "../../../../chrome/inspectorPage/InspectorPageSplit.tsx";
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
import { GlobalTimingInspector } from "./GlobalTimingInspector.tsx";
import { GlobalTimingWorkspace } from "./GlobalTimingWorkspace.tsx";
import { TimingMap } from "./TimingMap.tsx";
import { useGlobalChart } from "../../useGlobalChart.ts";
import { TimingDetectFooter } from "../../../editor/inspector/bpm/BpmPanel.tsx";
import { GLOBAL_PAGE_TUTORIALS } from "../../tutorials.ts";

const hasDocument = {
  get: () => getEditorVisibility().hasDocument,
  subscribe: subscribeToEditorVisibility,
};

/** The compact page: timing rows above the selected point's properties. */
function TimingInspectorPage() {
  const { t } = useTranslation();
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
  return (
    <InspectorPageSplit
      topLabel={t("editorPanels.inspector.form.bpm.title")}
      bottomLabel={t("editorPanels.inspector.form.bpm.attributes")}
      top={<GlobalTimingWorkspace />}
      bottom={<GlobalTimingInspector />}
    />
  );
}

/** The expanded workspace: full-height list, properties, and the BPM band map. */
function TimingStudio() {
  const chart = useGlobalChart();
  const entries = chart?.BPMList ?? [];
  return (
    <div className="timing-studio">
      <div className="studio-body">
        <div className="studio-list-pane">
          <GlobalTimingWorkspace variant="studio" />
        </div>
        <div className="studio-detail-pane">
          <GlobalTimingInspector />
        </div>
        <TimingMap entries={entries} chart={chart} />
      </div>
    </div>
  );
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
