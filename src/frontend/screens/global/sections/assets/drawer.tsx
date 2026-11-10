/**
 * Asset library as a drawer pane: the image tree on the left, the selected
 * asset's properties on the right.
 *
 * The tree keeps the one mount that prepares the asset library, so opening the
 * pane behaves the same way the global page did.
 */
import {
  registerDrawerPane,
  type DrawerPaneDefinition,
} from "../../../../chrome/drawer/drawerPanes.ts";
import { DrawerSplit } from "../../../../chrome/drawer/DrawerSplit.tsx";
import { GlobalAssetsInspector } from "./GlobalAssetsInspector.tsx";
import { GlobalAssetsWorkspace } from "./GlobalAssetsWorkspace.tsx";
import { GLOBAL_DRAWER_TUTORIALS } from "../../tutorials.ts";

/** The asset tree beside its detail face. */
function AssetsDrawerBody() {
  return <DrawerSplit list={<GlobalAssetsWorkspace />} properties={<GlobalAssetsInspector />} />;
}

const definition: DrawerPaneDefinition = {
  id: "assets",
  order: 40,
  label: "chrome.pane.assets",
  icon: "folder",
  body: AssetsDrawerBody,
  requiresDocument: true,
  tutorial: GLOBAL_DRAWER_TUTORIALS.assets,
  editsChart: true,
};

const dispose = registerDrawerPane(definition);

if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}
