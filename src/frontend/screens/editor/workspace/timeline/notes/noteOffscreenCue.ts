/** Resolves whether a scaled note body crosses its note timeline viewport. */

export type NoteOffscreenCueSide = "left" | "right";

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
