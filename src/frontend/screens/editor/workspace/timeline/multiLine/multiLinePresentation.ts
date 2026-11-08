// Presentation rules shared by multi-line drawing: opacity for non-current lines
// and zoom scaling for the active note or event area.
//
// These are pure calculations and read no session or DOM state.

/** Opacity applied to every multi-line panel except the active line. */
export const DEFAULT_MULTI_LINE_NON_CURRENT_OPACITY = 180 / 255;

/** Full opacity for the current line, configured opacity for every other line. */
export function multiLineLineOpacity(
  lineIndex: number,
  currentLineIndex: number,
  nonCurrentOpacity = DEFAULT_MULTI_LINE_NON_CURRENT_OPACITY,
): number {
  if (lineIndex === currentLineIndex) {
    return 1;
  }
  return Math.max(0, Math.min(1, Number(nonCurrentOpacity) || 0));
}

/** Scale note geometry to the width of one visible split multi-line panel. */
export function multiLinePanelScale(
  panelWidth: number,
  canvasWidth: number,
  active: boolean,
): number {
  if (!active) {
    return 1;
  }
  const safePanelWidth = Number(panelWidth);
  const safeCanvasWidth = Number(canvasWidth);
  if (
    !Number.isFinite(safePanelWidth) ||
    !Number.isFinite(safeCanvasWidth) ||
    safeCanvasWidth <= 0
  ) {
    return 1;
  }
  return safePanelWidth > 0 ? safePanelWidth / safeCanvasWidth : 1;
}

/** Apply the multi-line panel and user zoom scales only to the active area. */
export function multiLineScale(
  baseScale: number,
  zoom: number,
  active: boolean,
  panelScale = 1,
): number {
  const safePanelScale = Number.isFinite(panelScale) && panelScale > 0 ? panelScale : 1;
  return active
    ? baseScale * safePanelScale * Math.max(0.35, Math.min(6, Number(zoom) || 1))
    : baseScale;
}
