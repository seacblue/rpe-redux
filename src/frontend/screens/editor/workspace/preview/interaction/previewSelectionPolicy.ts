/** Owns the boundary between a preview click and a deliberate marquee drag. */

/** Pointer movement below this tolerance remains a click, including device jitter. */
export const PREVIEW_CLICK_TOLERANCE = 8;

/** Returns whether a pointer displacement is large enough to become a marquee. */
export function previewPointerMoved(
  start: { x: number; y: number },
  current: { x: number; y: number },
): boolean {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return dx * dx + dy * dy > PREVIEW_CLICK_TOLERANCE * PREVIEW_CLICK_TOLERANCE;
}
