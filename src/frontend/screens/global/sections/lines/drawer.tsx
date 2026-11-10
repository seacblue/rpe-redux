/**
 * Judge lines as a drawer pane: the tree on the left, the selected line's form
 * on the right.
 *
 * Both faces are the components the global page rendered side by side; the
 * drawer mode widens the inspector to reveal the tree beside the fixed form
 * column.
 */
import {
  registerDrawerPane,
  type DrawerPaneDefinition,
} from "../../../../chrome/drawer/drawerPanes.ts";
import { DrawerSplit } from "../../../../chrome/drawer/DrawerSplit.tsx";
import { GlobalLinesInspector } from "./GlobalLinesInspector.tsx";
import { GlobalLinesWorkspace } from "./GlobalLinesWorkspace.tsx";
import { GLOBAL_DRAWER_TUTORIALS } from "../../tutorials.ts";

/** The tree beside the selected line's form. */
function LinesDrawerBody() {
  return <DrawerSplit list={<GlobalLinesWorkspace />} properties={<GlobalLinesInspector />} />;
}

const definition: DrawerPaneDefinition = {
  id: "lines",
  order: 30,
  label: "chrome.pane.lines",
  icon: "grid",
  body: LinesDrawerBody,
  requiresDocument: true,
  tutorial: GLOBAL_DRAWER_TUTORIALS.lines,
  editsChart: true,
};

const dispose = registerDrawerPane(definition);

if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}
