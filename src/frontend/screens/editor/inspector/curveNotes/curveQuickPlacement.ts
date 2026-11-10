/**
 * Placement and drag bounds for the curve-note quick panel.
 *
 * The panel prefers the side of the picked path with more room and then clamps
 * itself into the visible timeline. Once the author drags its title row, the
 * card may cover the toolbar but stays below the window's title row and inside
 * the window.
 */

/** Space between the panel edge and the timeline viewport edge. */
export const QUICK_PANEL_MARGIN = 16;
/** Space between the painted path and the nearest panel edge. */
const QUICK_PANEL_GAP = 18;

export interface QuickViewportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface QuickPanelSize {
  width: number;
  height: number;
}

/** The panel's fixed position inside one timeline viewport. */
export function quickPanelPosition(
  anchor: { x: number; y: number },
  viewport: QuickViewportRect,
  size: QuickPanelSize,
): { left: number; top: number } {
  const x = Math.min(
    viewport.right - QUICK_PANEL_MARGIN,
    Math.max(viewport.left + QUICK_PANEL_MARGIN, anchor.x),
  );
  const y = Math.min(
    viewport.bottom - QUICK_PANEL_MARGIN,
    Math.max(viewport.top + QUICK_PANEL_MARGIN, anchor.y),
  );
  const leftRoom = x - viewport.left;
  const rightRoom = viewport.right - x;
  let left = rightRoom >= leftRoom ? x + QUICK_PANEL_GAP : x - QUICK_PANEL_GAP - size.width;
  if (left + size.width > viewport.right - QUICK_PANEL_MARGIN) {
    left = x - QUICK_PANEL_GAP - size.width;
  }
  if (left < viewport.left + QUICK_PANEL_MARGIN) {
    left = viewport.left + QUICK_PANEL_MARGIN;
  }
  if (left + size.width > viewport.right - QUICK_PANEL_MARGIN) {
    left = Math.max(
      viewport.left + QUICK_PANEL_MARGIN,
      viewport.right - QUICK_PANEL_MARGIN - size.width,
    );
  }
  let top = y - size.height / 2;
  const minimumTop = viewport.top + QUICK_PANEL_MARGIN;
  const maximumTop = viewport.bottom - QUICK_PANEL_MARGIN - size.height;
  top = Math.min(Math.max(minimumTop, top), Math.max(minimumTop, maximumTop));
  return { left, top };
}

/** Clamp a dragged panel inside the window and below its title row. */
export function clampDraggedPanel(
  left: number,
  top: number,
  size: QuickPanelSize,
  safeTop: number,
  windowSize: { width: number; height: number },
): { left: number; top: number } {
  const minimumTop = Math.max(0, safeTop);
  const maxLeft = Math.max(0, windowSize.width - size.width);
  const maxTop = Math.max(minimumTop, windowSize.height - size.height);
  return {
    left: Math.min(Math.max(0, left), maxLeft),
    top: Math.min(Math.max(minimumTop, top), maxTop),
  };
}
