/**
 * Snapshot cell for the multi-edit pane, created once per mounted editor tree.
 *
 * The snapshot holds the form element; the timeline preview reads the panel's
 * result directly, so it does not depend on where the pointer is.
 */
import { createValue, type ValueCell } from "../../../../../core/state/values.ts";
import type { ReactElement } from "react";

export interface MultiEditPanelSnapshot {
  view: ReactElement;
}

export type MultiEditState = ValueCell<MultiEditPanelSnapshot | null>;

/** Creates multi-edit inspector state for one mounted editor tree. */
export function createMultiEditState(): MultiEditState {
  return createValue<MultiEditPanelSnapshot | null>({ initial: null });
}
