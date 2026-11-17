/**
 * Distance rule shared by floating timeline controls that stay faint until the
 * pointer approaches them.
 *
 * The rule is pure geometry so the reveal threshold can be tested without a
 * browser; `useProximityReveal` maps pointer events onto it.
 */

/** Distance in CSS pixels outside a control that still counts as an approach. */
export const PROXIMITY_REVEAL_DISTANCE_PX = 24;

/** Client-space rectangle of the control being approached. */
export interface ProximityRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Whether a client-space point lies inside `rect` or within `marginPx` of it.
 *
 * The halo is radial: corners use the same margin as edges, so the distance
 * reads the same in every direction. A point inside the rectangle always
 * counts, including the border pixels.
 */
export function isPointNearRect(
  rect: ProximityRect,
  x: number,
  y: number,
  marginPx: number = PROXIMITY_REVEAL_DISTANCE_PX,
): boolean {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return dx * dx + dy * dy <= marginPx * marginPx;
}
