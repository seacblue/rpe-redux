/**
 * Owns the Inspector registration seam for the multi-line pane.
 *
 * The view remains responsible for rendering; this module contributes the
 * panel and independent shell routes that open it.
 */
import { registerInspectorPanel } from "../controller.ts";
import { registerInspectorSidebar, registerInspectorTool } from "../inspectorShell.ts";
import { MultiLineInspector } from "./MultiLineInspector.tsx";
import { INSPECTOR_TUTORIALS } from "../tutorials.ts";

const disposePanel = registerInspectorPanel({
  id: "multi-line",
  component: MultiLineInspector,
  label: "chrome.pane.multiLine",
  icon: "layers",
  tutorial: INSPECTOR_TUTORIALS["multi-line"],
});
const disposeTool = registerInspectorTool({
  panelId: "multi-line",
  id: "editor.multi-line-tool",
  label: "chrome.pane.multiLine",
  icon: "layers",
  order: 270,
});
const disposeSidebar = registerInspectorSidebar({
  id: "multi-line",
  order: 70,
  panelId: "multi-line",
  icon: "layers",
  label: "chrome.pane.multiLine",
  domId: "multi-line-tool",
});
const unregister = () => {
  disposeSidebar();
  disposeTool();
  disposePanel();
};

if (import.meta.hot) {
  import.meta.hot.dispose(unregister);
}
