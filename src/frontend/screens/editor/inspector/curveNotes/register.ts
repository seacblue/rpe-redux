/**
 * Owns the Inspector registration seam for the curve-note pane.
 *
 * The view remains responsible for rendering; this module contributes the
 * panel and independent shell routes that open it.
 */
import { registerInspectorPanel } from "../controller.ts";
import { registerInspectorSidebar, registerInspectorTool } from "../inspectorShell.ts";
import { CurvePanel } from "./CurvePanel.tsx";
import { curveActions } from "./actions.ts";
import { INSPECTOR_TUTORIALS } from "../tutorials.ts";

const disposePanel = registerInspectorPanel({
  id: "curve",
  component: CurvePanel,
  label: "chrome.inspector.curveTitle",
  icon: "curve",
  tutorial: INSPECTOR_TUTORIALS.curve,
  open: () => curveActions.openCurveNotes(),
  editsChart: true,
});
const disposeTool = registerInspectorTool({
  panelId: "curve",
  id: "editor.curve-notes",
  label: "chrome.pane.curve",
  icon: "curve",
  order: 250,
  separatorBefore: true,
});
const disposeSidebar = registerInspectorSidebar({
  id: "curve",
  order: 50,
  panelId: "curve",
  icon: "curve",
  label: "chrome.pane.curve",
  domId: "curve-notes",
});
const unregister = () => {
  disposeSidebar();
  disposeTool();
  disposePanel();
};

if (import.meta.hot) {
  import.meta.hot.dispose(unregister);
}
