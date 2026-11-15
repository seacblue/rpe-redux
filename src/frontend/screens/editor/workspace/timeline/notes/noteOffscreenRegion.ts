/** Computes the note timeline background outside the authored X coordinate field. */
import { NOTE_X_SPAN } from "../../../../../../core/edit/timeline/timelineCoordinates.ts";

/** One clipped offscreen background segment and the side of its seam. */
export type OffscreenRegionSegment = {
  x: number;
  width: number;
  side: "left" | "right";
};

/** Create the soft seam gradient for one clipped offscreen segment. */
export function offscreenRegionGradient(
  context: CanvasRenderingContext2D,
  segment: OffscreenRegionSegment,
  color: string,
): CanvasGradient {
  const feather = Math.min(segment.width, 32);
  const gradient = context.createLinearGradient(segment.x, 0, segment.x + segment.width, 0);
  if (segment.side === "left") {
    gradient.addColorStop(0, color);
    gradient.addColorStop(Math.max(0, 1 - feather / segment.width), color);
    gradient.addColorStop(1, "transparent");
  } else {
    gradient.addColorStop(0, "transparent");
    gradient.addColorStop(Math.min(1, feather / segment.width), color);
    gradient.addColorStop(1, color);
  }
  return gradient;
}

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
): OffscreenRegionSegment[] {
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
  const segments: OffscreenRegionSegment[] = [];
  const leftEnd = Math.min(visibleRight, bounds.left);
  if (leftEnd > visibleLeft) {
    segments.push({ x: visibleLeft, width: leftEnd - visibleLeft, side: "left" });
  }
  const rightStart = Math.max(visibleLeft, bounds.right);
  if (visibleRight > rightStart) {
    segments.push({ x: rightStart, width: visibleRight - rightStart, side: "right" });
  }
  return segments;
}
