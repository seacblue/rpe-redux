/** Pure viewport geometry shared by draggable floating panels and their tests. */

/** Measured size of a floating panel. */
export interface FloatingPanelSize {
  width: number;
  height: number;
}

/** Viewport dimensions used to clamp a panel position. */
export interface FloatingPanelViewport {
  width: number;
  height: number;
}

/** Clamp a panel's top-left point below the host chrome and inside the viewport. */
export function clampFloatingPanelPosition(
  left: number,
  top: number,
  size: FloatingPanelSize,
  safeTop: number,
  viewport: FloatingPanelViewport,
): { left: number; top: number } {
  const minimumTop = Math.max(0, safeTop);
  const maxLeft = Math.max(0, viewport.width - size.width);
  const maxTop = Math.max(minimumTop, viewport.height - size.height);
  return {
    left: Math.min(Math.max(0, left), maxLeft),
    top: Math.min(Math.max(minimumTop, top), maxTop),
  };
}
