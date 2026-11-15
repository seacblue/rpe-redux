/**
 * Computes the visible left and right background segments outside the authored
 * note field of one timeline panel.
 */

export interface OffscreenRegionSegment {
  readonly x: number;
  readonly width: number;
}

/** Return clipped background segments outside the authored horizontal range. */
export function offscreenRegionSegments(
  panelLeft: number,
  panelRight: number,
  authoredLeft: number,
  authoredRight: number,
  viewportWidth: number,
): OffscreenRegionSegment[] {
  if (![panelLeft, panelRight, authoredLeft, authoredRight, viewportWidth].every(Number.isFinite)) {
    return [];
  }
  const visibleLeft = Math.max(0, panelLeft);
  const visibleRight = Math.min(viewportWidth, panelRight);
  if (visibleRight <= visibleLeft || viewportWidth <= 0) {
    return [];
  }
  const segments: OffscreenRegionSegment[] = [];
  const leftEnd = Math.min(visibleRight, authoredLeft);
  if (leftEnd > visibleLeft) {
    segments.push({ x: visibleLeft, width: leftEnd - visibleLeft });
  }
  const rightStart = Math.max(visibleLeft, authoredRight);
  if (visibleRight > rightStart) {
    segments.push({ x: rightStart, width: visibleRight - rightStart });
  }
  return segments;
}
