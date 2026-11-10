/**
 * Registers the scripts pane, its tools action, and its sidebar button, and
 * installs the global parameter-dialog host that script actions need.
 *
 * The host is disposed together with the pane contributions, including under hot
 * reload.
 */
import { registerInspectorPanel } from "../controller.ts";
import { registerInspectorSidebar, registerInspectorTool } from "../inspectorShell.ts";
import { ScriptsPanel } from "./ScriptsPanel.tsx";
import { installParameterFormHost } from "./ParameterForm.tsx";
import { registerSidebarDivider } from "../../../../../core/shell/registries/sidebar.ts";
import { INSPECTOR_TUTORIALS } from "../tutorials.ts";

// The parameter dialog is a global host owned by this pane's feature: a
// shortcut can run a script without this pane being mounted.
const disposeParameterFormHost = installParameterFormHost();

const disposePanel = registerInspectorPanel({
  id: "scripts",
  component: ScriptsPanel,
  label: "editorPanels.scripts.title",
  icon: "extension",
  tutorial: INSPECTOR_TUTORIALS.scripts,
  editsChart: true,
});
const disposeTool = registerInspectorTool({
  panelId: "scripts",
  id: "workspace.scripts.open",
  label: "editorPanels.scripts.title",
  icon: "extension",
  order: 280,
  separatorBefore: true,
});
const disposeDivider = registerSidebarDivider({
  kind: "divider",
  id: "scripts.divider",
  order: 75,
});
const disposeSidebar = registerInspectorSidebar({
  id: "scripts",
  order: 80,
  panelId: "scripts",
  icon: "extension",
  label: "editorPanels.scripts.title",
  domId: "scripts-pane",
});

const unregister = () => {
  disposeParameterFormHost();
  disposeDivider();
  disposeSidebar();
  disposeTool();
  disposePanel();
};

if (import.meta.hot) {
  import.meta.hot.dispose(unregister);
}
