/**
 * Registers chart metadata as an ordinary inspector pane and its sidebar route.
 *
 * Metadata stays the first document destination in the sidebar, but it no longer
 * opens the drawer: the page is a single form with no list column, so it belongs
 * to the normal inspector content mode.
 */
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../../../core/edit/state/visibility.ts";
import { registerInspectorPanel } from "../controller.ts";
import { registerInspectorSidebar } from "../inspectorShell.ts";
import { MetadataPanel } from "./MetadataPanel.tsx";
import { INSPECTOR_TUTORIALS } from "../tutorials.ts";

const hasDocument = {
  get: () => getEditorVisibility().hasDocument,
  subscribe: subscribeToEditorVisibility,
};

const disposePanel = registerInspectorPanel({
  id: "metadata",
  component: MetadataPanel,
  label: "chrome.pane.metadata",
  icon: "info",
  tutorial: INSPECTOR_TUTORIALS.metadata,
  editsChart: true,
});
const disposeSidebar = registerInspectorSidebar({
  id: "metadata",
  order: 10,
  panelId: "metadata",
  icon: "info",
  label: "chrome.pane.metadata",
  domId: "metadata-pane",
  visibility: hasDocument,
});
const unregister = () => {
  disposeSidebar();
  disposePanel();
};

if (import.meta.hot) {
  import.meta.hot.dispose(unregister);
}
