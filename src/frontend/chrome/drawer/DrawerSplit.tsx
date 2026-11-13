/**
 * Two-column page split for the document drawer.
 *
 * A drawer page supplies a list and a property face. The properties keep the
 * inspector's resting width while the list occupies the extra width that the
 * widened inspector exposes; this component owns only the columns and the seam,
 * so both faces scroll independently and the page never learns how much room it
 * was given.
 *
 * The property column uses the same page content layer as an ordinary inspector
 * pane, so its scrollbar stays on the column edge and its form keeps the shared
 * content inset.
 */
import type { ReactNode } from "react";
import { InspectorPage } from "../inspectorPage/InspectorPage.tsx";

/**
 * The fixed property column on the right and the list column on the left.
 *
 * The drawer mode stylesheet fixes both column widths and clips the pair behind
 * the inspector's edge, so revealing the list never changes the grid track or
 * remounts either face.
 */
export function DrawerSplit({ list, properties }: { list: ReactNode; properties: ReactNode }) {
  return (
    <div className="drawer-split">
      <div className="drawer-split-list">{list}</div>
      <div className="drawer-split-properties">
        <InspectorPage>{properties}</InspectorPage>
      </div>
    </div>
  );
}
