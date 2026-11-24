/** Tracks whether an overlap-menu press became a real pointer drag. */

export interface OverlapPressPoint {
  readonly x: number;
  readonly y: number;
}

export interface OverlapPress {
  readonly start: OverlapPressPoint;
  readonly moved: boolean;
}

/** The movement threshold that separates a click from a timeline drag. */
export const OVERLAP_CLICK_SLOP = 4;

/** Return the overlap press after applying one pointer position. */
export function updateOverlapPress(press: OverlapPress, point: OverlapPressPoint): OverlapPress {
  if (press.moved) {
    return press;
  }
  return Math.hypot(point.x - press.start.x, point.y - press.start.y) > OVERLAP_CLICK_SLOP
    ? { ...press, moved: true }
    : press;
}

/** Whether an overlap press is still an in-place click that may open its menu. */
export function canOpenOverlapMenu(press: OverlapPress | null): boolean {
  return press !== null && !press.moved;
}
