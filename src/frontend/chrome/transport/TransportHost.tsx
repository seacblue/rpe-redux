/**
 * Hosts the shared transport card in the toolbar.
 *
 * The card stays mounted in one React position for the whole session, so the
 * scrubber, marker layer, and spectrum canvas keep the same DOM nodes the
 * editor assembly captured at mount. Placement is host-owned: the card lives in
 * the toolbar's trailing column and never floats or moves.
 */
import { useSyncExternalStore } from "react";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../core/edit/state/visibility.ts";
import { ChartProgress } from "./ChartProgress.tsx";

/** The transport card with a stable mount point inside the toolbar. */
export function TransportHost() {
  const visible = useSyncExternalStore(
    subscribeToEditorVisibility,
    getEditorVisibility,
    getEditorVisibility,
  );
  return (
    <div className="transport-host" hidden={visible.atHome}>
      <ChartProgress />
    </div>
  );
}
