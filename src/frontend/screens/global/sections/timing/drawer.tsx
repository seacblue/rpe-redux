/**
 * BPM/timing as a drawer pane: timing-point rows on the left, attributes on the
 * right.
 *
 * The rows and the attribute form are the components the global page rendered in
 * two columns; the drawer mode widens the inspector to reveal the row list beside
 * the fixed attribute column.
 */
import {
  registerDrawerPane,
  type DrawerPaneDefinition,
} from "../../../../chrome/drawer/drawerPanes.ts";
import { DrawerSplit } from "../../../../chrome/drawer/DrawerSplit.tsx";
import { GlobalTimingInspector } from "./GlobalTimingInspector.tsx";
import { GlobalTimingWorkspace } from "./GlobalTimingWorkspace.tsx";
import { GLOBAL_DRAWER_TUTORIALS } from "../../tutorials.ts";

/** The timing list beside the selected point's attribute form. */
function TimingDrawerBody() {
  return <DrawerSplit list={<GlobalTimingWorkspace />} properties={<GlobalTimingInspector />} />;
}

const definition: DrawerPaneDefinition = {
  id: "timing",
  order: 20,
  label: "chrome.pane.bpm",
  icon: "bpm",
  body: TimingDrawerBody,
  requiresDocument: true,
  tutorial: GLOBAL_DRAWER_TUTORIALS.timing,
  editsChart: true,
};

const dispose = registerDrawerPane(definition);

if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}
