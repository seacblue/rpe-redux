/**
 * Owns the Inspector registration seam for the events pane.
 *
 * The view remains responsible for rendering; this module contributes the
 * panel to the discovered registry without adding a shell import.
 */
import { registerInspectorPanel } from "../controller.ts";
import { EventsPanel } from "./EventsPanel.tsx";
import { INSPECTOR_TUTORIALS } from "../tutorials.ts";

const unregister = registerInspectorPanel({
  id: "events",
  component: EventsPanel,
  label: "chrome.pane.events",
  icon: "sliders",
  tutorial: INSPECTOR_TUTORIALS.events,
  editsChart: true,
});

if (import.meta.hot) {
  import.meta.hot.dispose(unregister);
}
