/**
 * Owns the Inspector registration seam for the multi-edit pane.
 *
 * The view remains responsible for rendering; this module contributes the
 * panel to the discovered registry without adding a shell import.
 */
import { registerInspectorPanel } from "../controller.ts";
import { MultiEditInspector } from "./MultiEditInspector.tsx";
import { INSPECTOR_TUTORIALS } from "../tutorials.ts";

const unregister = registerInspectorPanel({
  id: "multi",
  component: MultiEditInspector,
  label: "chrome.pane.multiEdit",
  icon: "layers",
  tutorial: INSPECTOR_TUTORIALS.multi,
  editsChart: true,
});

if (import.meta.hot) {
  import.meta.hot.dispose(unregister);
}
