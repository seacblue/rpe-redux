/**
 * Registers the history pane, its tools action, and its sidebar button.
 *
 * All three handles are released by one disposer, including under hot reload.
 */
import { registerInspectorPanel } from "../controller.ts";
import { registerInspectorSidebar, registerInspectorTool } from "../inspectorShell.ts";
import { HistoryPanel } from "./HistoryPanel.tsx";
import { INSPECTOR_TUTORIALS } from "../tutorials.ts";

const disposePanel = registerInspectorPanel({
  id: "history",
  component: HistoryPanel,
  label: "workspace.history.title",
  icon: "clock",
  tutorial: INSPECTOR_TUTORIALS.history,
  editsChart: true,
});
const disposeTool = registerInspectorTool({
  panelId: "history",
  id: "workspace.history.open",
  label: "workspace.history.title",
  icon: "clock",
  order: 290,
});
const disposeSidebar = registerInspectorSidebar({
  id: "history",
  order: 90,
  panelId: "history",
  icon: "clock",
  label: "workspace.history.title",
  domId: "history-pane",
});

const unregister = () => {
  disposeSidebar();
  disposeTool();
  disposePanel();
};

if (import.meta.hot) {
  import.meta.hot.dispose(unregister);
}
