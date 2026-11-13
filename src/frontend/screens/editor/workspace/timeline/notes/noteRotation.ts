/**
 * Maps same-beat overlap ranks to the fixed rotation used by the timeline note
 * field. Painting and pointer hit testing share this rule so a rotated note is
 * selected through the box the user sees.
 */

/** Signed degrees per note rank in one overlap stack. */
export const NOTE_OVERLAP_ROTATION_STEP_DEGREES = 15;

/** Signed radians per note rank in one overlap stack. */
export const NOTE_OVERLAP_ROTATION_STEP = (NOTE_OVERLAP_ROTATION_STEP_DEGREES * Math.PI) / 180;

/** Rotation in radians for one note's overlap rank; an absent rank stays upright. */
export function noteOverlapRotation(rank: number | undefined): number {
  const normalizedRank = rank ?? 0;
  return normalizedRank === 0 ? 0 : -normalizedRank * NOTE_OVERLAP_ROTATION_STEP;
}
