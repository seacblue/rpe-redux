/**
 * Resolves the edge markers used when a note at the current beat is outside
 * the visible X range of its note timeline.
 */

export type NoteOffscreenCueSide = "left" | "right";

/** Resolve a cue's X coordinate on the visible edge of one note panel. */
export function offscreenCueX(
  side: NoteOffscreenCueSide,
  panelLeft: number,
  panelRight: number,
  width: number,
  cueWidth: number,
): number | null {
  if (
    ![panelLeft, panelRight, width, cueWidth].every(Number.isFinite) ||
    panelRight <= panelLeft ||
    width <= 0 ||
    cueWidth <= 0
  ) {
    return null;
  }
  const visibleLeft = Math.max(0, panelLeft);
  const visibleRight = Math.min(width, panelRight);
  if (visibleRight <= visibleLeft) {
    return null;
  }
  const maxX = Math.max(0, width - cueWidth);
  return side === "left"
    ? Math.min(maxX, visibleLeft)
    : Math.min(maxX, Math.max(0, visibleRight - cueWidth));
}

/** Return whether a note interval contains the current playhead beat. */
export function noteContainsBeat(start: number, end: number, beat: number): boolean {
  if (![start, end, beat].every(Number.isFinite)) {
    return false;
  }
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  return beat >= low - 1e-6 && beat <= high + 1e-6;
}

/** Return each panel edge crossed by a note body. */
export function offscreenCueSides(
  horizontal: number,
  noteWidth: number,
  panelLeft: number,
  panelRight: number,
): NoteOffscreenCueSide[] {
  if (
    ![horizontal, noteWidth, panelLeft, panelRight].every(Number.isFinite) ||
    panelRight <= panelLeft
  ) {
    return [];
  }
  const halfWidth = Math.max(0, noteWidth) / 2;
  const sides: NoteOffscreenCueSide[] = [];
  if (horizontal - halfWidth < panelLeft) {
    sides.push("left");
  }
  if (horizontal + halfWidth > panelRight) {
    sides.push("right");
  }
  return sides;
}
