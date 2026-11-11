/**
 * Shared state for the pointer-position overlap picker.
 *
 * The picker lists the objects under one pointer position. Its rows are drawn
 * by the shared context-menu renderer without inheriting right-click commands.
 */
import {
  createContextMenuState,
  type ContextMenuAnchor,
} from "../contextMenu/ContextMenuPopup.tsx";

/** One layer choice offered by the overlap picker. */
export interface OverlapMenuAction {
  id: string;
  label: string;
  detail?: string;
  /** Paint the row's object in the selection colour while the pointer is on it. */
  onHover?(): void;
  /** Restore the row's object when the pointer leaves without choosing it. */
  onLeave?(): void;
  run(): void;
}

/** Snapshot of the open overlap picker: pointer anchor, heading, and choices. */
export interface OverlapMenuSnapshot extends ContextMenuAnchor {
  title: string;
  actions: readonly OverlapMenuAction[];
  /** Drop every transient row highlight when the picker closes. */
  onClose?(): void;
}

export const overlapMenu = createContextMenuState<OverlapMenuSnapshot>();

/** Open the layer-style picker at a pointer position. */
export function openOverlapMenu(
  owner: HTMLElement | null,
  x: number,
  y: number,
  title: string,
  actions: readonly OverlapMenuAction[],
  onClose?: () => void,
): void {
  // Defer by one task so the click that follows pointer-up does not dismiss the
  // newly opened popover as an outside click.
  setTimeout(() => overlapMenu.set({ owner, x, y, title, actions, onClose }), 0);
}
