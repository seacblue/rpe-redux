/**
 * Timing page: one stable compact Inspector stack.
 *
 * The timing workspace experiment is intentionally removed here until its
 * replacement has a stable geometry contract.
 */
import { useTranslation } from "../../../../../i18n/react.ts";
import { InspectorPageSplit } from "../../../../chrome/inspectorPage/InspectorPageSplit.tsx";
import { registerInspectorPanel } from "../../../editor/inspector/controller.ts";
import { registerInspectorSidebar } from "../../../editor/inspector/inspectorShell.ts";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../../../core/edit/state/visibility.ts";
import { GlobalTimingInspector } from "./GlobalTimingInspector.tsx";
import { GlobalTimingWorkspace } from "./GlobalTimingWorkspace.tsx";
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
      resizable={false}
    />
  );
}

const disposePanel = registerInspectorPanel({
  id: "timing",
  component: TimingInspectorPage,
  label: "chrome.pane.bpm",
  icon: "bpm",
  tutorial: GLOBAL_PAGE_TUTORIALS.timing,
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

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeSidebar();
    disposePanel();
  });
}
