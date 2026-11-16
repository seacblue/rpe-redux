/** Resolves whether a scaled note body is fully outside its note timeline viewport. */

export type NoteOffscreenCueSide = "left" | "right";

/** Map overflow distance to the cue's base opacity. */
export function offscreenCueAlpha(distance: number, viewportWidth: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(viewportWidth) || distance < 0) {
    return 0;
  }
  const safeViewportWidth = Math.max(1, viewportWidth);
  const quickRamp = Math.max(1, Math.min(16, safeViewportWidth * 0.08));
  const quickProgress = Math.min(1, distance / quickRamp);
  const slowProgress = Math.min(
    1,
    Math.max(0, (distance - quickRamp) / Math.max(1, safeViewportWidth - quickRamp)),
  );
  return 0.2 * quickProgress + 0.3 * slowProgress;
}

/** Return how far a note body is beyond one viewport side, or null when visible. */
export function offscreenCueDistance(
  horizontal: number,
  noteWidth: number,
  panelLeft: number,
  panelRight: number,
  side: NoteOffscreenCueSide,
): number | null {
  if (
    ![horizontal, noteWidth, panelLeft, panelRight].every(Number.isFinite) ||
    panelRight <= panelLeft
  ) {
    return null;
  }
  const halfWidth = Math.max(0, noteWidth) / 2;
  const distance =
    side === "left" ? panelLeft - (horizontal + halfWidth) : horizontal - halfWidth - panelRight;
  return distance >= 0 ? distance : null;
}

/** Return each panel side where a note body is completely out of view. */
export function offscreenCueSides(
  horizontal: number,
  noteWidth: number,
  panelLeft: number,
  panelRight: number,
): NoteOffscreenCueSide[] {
  const sides: NoteOffscreenCueSide[] = [];
  if (offscreenCueDistance(horizontal, noteWidth, panelLeft, panelRight, "left") !== null) {
    sides.push("left");
  }
  if (offscreenCueDistance(horizontal, noteWidth, panelLeft, panelRight, "right") !== null) {
    sides.push("right");
  }
  return sides;
}
