/**
 * Registers the chart issues pane and its sidebar route.
 *
 * The pane reads the editor runtime's event-issue monitor; this module only
 * contributes the panel and the shell entry that opens it.
 */
import { registerInspectorPanel } from "../controller.ts";
import { registerInspectorSidebar } from "../inspectorShell.ts";
import { IssuesPanel } from "./IssuesPanel.tsx";
import { INSPECTOR_TUTORIALS } from "../tutorials.ts";
import {
  chartIssueBadgeTone,
  chartIssueCount,
} from "../../../../../core/edit/validation/eventIssueMonitor.ts";

const disposePanel = registerInspectorPanel({
  id: "issues",
  component: IssuesPanel,
  label: "chrome.pane.issues",
  icon: "shield",
  tutorial: INSPECTOR_TUTORIALS.issues,
});
const disposeSidebar = registerInspectorSidebar({
  id: "issues",
  order: 85,
  panelId: "issues",
  icon: "shield",
  label: "chrome.pane.issues",
  domId: "issues-pane",
  badge: chartIssueCount,
  badgeTone: chartIssueBadgeTone,
});

const unregister = () => {
  disposeSidebar();
  disposePanel();
};

if (import.meta.hot) {
  import.meta.hot.dispose(unregister);
}
