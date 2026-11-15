/** Computes the note timeline background outside the authored X coordinate field. */
import { NOTE_X_SPAN } from "../../../../../../core/edit/timeline/timelineCoordinates.ts";

/** Return the authored X bounds projected into one panel for a camera center. */
export function authoredXBounds(
  panelLeft: number,
  panelRight: number,
  cameraX: number,
): { left: number; right: number } | null {
  if (![panelLeft, panelRight, cameraX].every(Number.isFinite) || panelRight <= panelLeft) {
    return null;
  }
  const panelWidth = panelRight - panelLeft;
  const shift = (-cameraX / NOTE_X_SPAN) * panelWidth;
  return {
    left: panelLeft + shift,
    right: panelLeft + shift + panelWidth,
  };
}

/** Return visible background segments outside the authored X interval. */
export function offscreenRegionSegments(
  panelLeft: number,
  panelRight: number,
  cameraX: number,
  viewportWidth: number,
): Array<{ x: number; width: number }> {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return [];
  }
  const bounds = authoredXBounds(panelLeft, panelRight, cameraX);
  if (!bounds) {
    return [];
  }
  const visibleLeft = Math.max(0, panelLeft);
  const visibleRight = Math.min(viewportWidth, panelRight);
  if (visibleRight <= visibleLeft) {
    return [];
  }
  const segments: Array<{ x: number; width: number }> = [];
  const leftEnd = Math.min(visibleRight, bounds.left);
  if (leftEnd > visibleLeft) {
    segments.push({ x: visibleLeft, width: leftEnd - visibleLeft });
  }
  const rightStart = Math.max(visibleLeft, bounds.right);
  if (visibleRight > rightStart) {
    segments.push({ x: rightStart, width: visibleRight - rightStart });
  }
  return segments;
}
