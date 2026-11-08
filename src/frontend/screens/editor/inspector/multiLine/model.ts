/**
 * Snapshot cell for the multi-line pane, created once per mounted editor tree.
 *
 * Each publication carries a revision so subscribers can distinguish updates;
 * the host keys the form by session identity so selection repaints keep the
 * mounted list while a replaced session starts with fresh drafts.
 */
import { createValue, type ValueCell } from "../../../../../core/state/values.ts";
import type { MultiLinePanelProps } from "./MultiLinePanel.tsx";

/** One published form revision and the props it mounts with. */
export interface MultiLinePanelSnapshot {
  revision: number;
  props: MultiLinePanelProps;
}

export type MultiLinePanelState = ValueCell<MultiLinePanelSnapshot | null>;

/** Creates multi-line inspector state for one mounted editor tree. */
export function createMultiLinePanelState(): MultiLinePanelState {
  return createValue<MultiLinePanelSnapshot | null>({ initial: null });
}
