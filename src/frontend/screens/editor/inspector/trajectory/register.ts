/**
 * Registers curve preview as a normal Inspector pane.
 *
 * The pane is the mode's control surface; while it is active, the canvas overlay
 * is visible. Switching to another Inspector pane leaves curve mode, so the
 * canvas never runs without its controls.
 *
 * The pane is reachable from the sidebar and the tools list; both entries open
 * the same curve-preview surface.
 */
import { registerInspectorPanel } from "../controller.ts";
import { registerInspectorSidebar, registerInspectorTool } from "../inspectorShell.ts";
import { CurveEventsInspector } from "../../curveEvents/CurveEventsInspector.tsx";
import { INSPECTOR_TUTORIALS } from "../tutorials.ts";

const disposePanel = registerInspectorPanel({
  id: "curve-preview",
  component: CurveEventsInspector,
  label: "chrome.pane.trajectory",
  icon: "route",
  tutorial: INSPECTOR_TUTORIALS["curve-preview"],
  editsChart: true,
});
const disposeEntry = [
  registerInspectorTool({
    panelId: "curve-preview",
    id: "editor.curve-preview",
    label: "chrome.pane.trajectory",
    icon: "route",
    order: 260,
  }),
  registerInspectorSidebar({
    id: "curve-preview",
    order: 60,
    panelId: "curve-preview",
    icon: "route",
    label: "chrome.pane.trajectory",
    domId: "curve-preview",
  }),
];
const unregister = () => {
  for (const dispose of disposeEntry.reverse()) {
    dispose();
  }
  disposePanel();
};

if (import.meta.hot) {
  import.meta.hot.dispose(unregister);
}
