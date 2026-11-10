/**
 * Owns the Inspector registration seam for the notes pane.
 *
 * The view remains responsible for rendering; this module contributes the
 * panel to the discovered registry without adding a shell import.
 */
import { registerInspectorPanel } from "../controller.ts";
import { NotesPanel } from "./NotesPanel.tsx";
import { INSPECTOR_TUTORIALS } from "../tutorials.ts";

const unregister = registerInspectorPanel({
  id: "notes",
  component: NotesPanel,
  label: "chrome.pane.notes",
  icon: "pencil",
  tutorial: INSPECTOR_TUTORIALS.notes,
  editsChart: true,
});

if (import.meta.hot) {
  import.meta.hot.dispose(unregister);
}
