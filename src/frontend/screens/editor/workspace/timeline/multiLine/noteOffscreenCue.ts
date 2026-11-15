/**
 * Resolves the small edge markers used when a note at the current beat is
 * clipped outside the visible horizontal timeline area.
 */

export type NoteOffscreenCueSide = "left" | "right";

/** Return whether a note interval contains the current playhead beat. */
export function noteContainsBeat(start: number, end: number, beat: number): boolean {
  if (![start, end, beat].every(Number.isFinite)) {
    return false;
  }
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  return beat >= low - 1e-6 && beat <= high + 1e-6;
}

/** Return each viewport edge crossed by a note body. */
export function offscreenCueSides(
  horizontal: number,
  noteWidth: number,
  viewportWidth: number,
): NoteOffscreenCueSide[] {
  if (![horizontal, noteWidth, viewportWidth].every(Number.isFinite) || viewportWidth <= 0) {
    return [];
  }
  const halfWidth = Math.max(0, noteWidth) / 2;
  const sides: NoteOffscreenCueSide[] = [];
  if (horizontal - halfWidth < 0) {
    sides.push("left");
  }
  if (horizontal + halfWidth > viewportWidth) {
    sides.push("right");
  }
  return sides;
}
