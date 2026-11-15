/**
 * Shared pixel-space hover rules for timeline guide lines.
 *
 * Horizontal beat guides use a uniform line-wide falloff, while note and event
 * separators use a radial pixel reveal with nearest-pixel colour emphasis.
 */

/** Pixel radius over which the timeline's horizontal hover emphasis fades out. */
export const HORIZONTAL_HOVER_RADIUS = 144;

/** Maximum pixel distance at which a vertical timeline guide can be hovered. */
export const VERTICAL_HOVER_DISTANCE = 15;

/** Pixel-space pointer used by the radial vertical-guide reveal. */
export interface TimelineGuidePointer {
  readonly x: number;
  readonly y: number;
}

/** Return a smooth 0..1 hover strength for one horizontal guide. */
export function horizontalGuideHoverOpacity(
  linePosition: number,
  pointerPosition: number | null,
  radius = HORIZONTAL_HOVER_RADIUS,
): number {
  if (
    pointerPosition === null ||
    !Number.isFinite(linePosition) ||
    !Number.isFinite(pointerPosition) ||
    !Number.isFinite(radius) ||
    radius <= 0
  ) {
    return 0;
  }
  const distance = Math.abs(linePosition - pointerPosition);
  if (distance >= radius) {
    return 0;
  }
  const remaining = 1 - distance / radius;
  return remaining * remaining * (3 - 2 * remaining);
}

/** Match a vertical guide using its actual screen-pixel distance from the pointer. */
export function isPixelGuideHovered(
  linePosition: number,
  pointerPosition: number | null,
  maxDistance = VERTICAL_HOVER_DISTANCE,
): boolean {
  return (
    pointerPosition !== null &&
    Number.isFinite(linePosition) &&
    Number.isFinite(pointerPosition) &&
    Number.isFinite(maxDistance) &&
    maxDistance >= 0 &&
    Math.abs(linePosition - pointerPosition) <= maxDistance
  );
}

/** Return the nearest vertical guide when it is within the pixel hover radius. */
export function nearestPixelGuidePosition(
  positions: readonly number[],
  pointerPosition: number | null,
  maxDistance = VERTICAL_HOVER_DISTANCE,
): number | null {
  if (pointerPosition === null || !Number.isFinite(pointerPosition)) {
    return null;
  }
  let nearest: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const position of positions) {
    const distance = Math.abs(position - pointerPosition);
    if (distance < nearestDistance) {
      nearest = position;
      nearestDistance = distance;
    }
  }
  return nearest !== null && nearestDistance <= maxDistance ? nearest : null;
}

/** Return the radial opacity of one pixel on a vertical guide. */
export function verticalGuidePixelOpacity(
  linePosition: number,
  pixelPosition: number,
  pointer: TimelineGuidePointer | null,
  radius = HORIZONTAL_HOVER_RADIUS,
): number {
  if (
    pointer === null ||
    !Number.isFinite(linePosition) ||
    !Number.isFinite(pixelPosition) ||
    !Number.isFinite(pointer.x) ||
    !Number.isFinite(pointer.y) ||
    !Number.isFinite(radius) ||
    radius <= 0
  ) {
    return 0;
  }
  const distance = Math.hypot(linePosition - pointer.x, pixelPosition - pointer.y);
  if (distance >= radius) {
    return 0;
  }
  const remaining = 1 - distance / radius;
  return remaining * remaining * (3 - 2 * remaining);
}

/** Paint a vertical guide with the sampling-style pixel-space reveal. */
export function strokeVerticalGuide(
  context: CanvasRenderingContext2D,
  position: number,
  height: number,
  pointer: TimelineGuidePointer | null,
  nearbyOnly: boolean,
): void {
  if (!nearbyOnly) {
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, height);
    context.stroke();
    return;
  }
  if (!pointer || height <= 0) {
    return;
  }
  const previousAlpha = context.globalAlpha;
  const segmentHeight = 4;
  for (let top = 0; top < height; top += segmentHeight) {
    const bottom = Math.min(height, top + segmentHeight);
    const opacity = verticalGuidePixelOpacity(position, (top + bottom) / 2, pointer);
    context.globalAlpha = previousAlpha * opacity;
    context.beginPath();
    context.moveTo(position, top);
    context.lineTo(position, bottom);
    context.stroke();
  }
  context.globalAlpha = previousAlpha;
}
