/**
 * Registers the AI activity pane as an Inspector surface and its tools/sidebar
 * routes.
 *
 * The pane is a normal inspector contribution; it is not a second shell or a
 * modal workflow. The sidebar route is hidden while code execution is disabled;
 * the tools entry stays reachable so a user can discover the log and open the
 * settings that turn AI access on.
 */
import { registerInspectorPanel } from "../controller.ts";
import { registerInspectorSidebar, registerInspectorTool } from "../inspectorShell.ts";
import { AiActivityPanel } from "./AiActivityPanel.tsx";
import { values } from "../../../../../core/state/values.ts";
import { registerSidebarDivider } from "../../../../../core/shell/registries/sidebar.ts";
import { INSPECTOR_TUTORIALS } from "../tutorials.ts";

const SETTING = "code-execution-enabled";

const enabled = {
  get: () => values.byId.has(SETTING) && values.byId.get<boolean>(SETTING) === true,
  subscribe: (listener: () => void) =>
    values.byId.has(SETTING) ? values.byId.subscribe(SETTING, listener) : () => {},
};

const disposePanel = registerInspectorPanel({
  id: "code-cell",
  component: AiActivityPanel,
  label: "editorPanels.aiActivity.title",
  icon: "bot",
  tutorial: INSPECTOR_TUTORIALS["code-cell"],
});
const disposeTool = registerInspectorTool({
  panelId: "code-cell",
  id: "workspace.codeCell.open",
  label: "editorPanels.aiActivity.title",
  icon: "bot",
  order: 300,
  separatorBefore: true,
});
const disposeDivider = registerSidebarDivider({
  kind: "divider",
  id: "code-cell.divider",
  order: 92,
});
const disposeSidebar = registerInspectorSidebar({
  id: "code-cell",
  order: 95,
  panelId: "code-cell",
  icon: "bot",
  label: "editorPanels.aiActivity.title",
  domId: "code-cell-pane",
  visibility: enabled,
});

const unregister = () => {
  disposeSidebar();
  disposeDivider();
  disposeTool();
  disposePanel();
};

if (import.meta.hot) {
  import.meta.hot.dispose(unregister);
}
