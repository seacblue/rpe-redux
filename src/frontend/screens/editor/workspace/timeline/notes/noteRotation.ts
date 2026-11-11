/**
 * Maps same-beat overlap ranks to the fixed rotation used by the timeline note
 * field. Painting and pointer hit testing share this rule so a rotated note is
 * selected through the box the user sees.
 */

/** Degrees added for each note after the first in one overlap stack. */
export const NOTE_OVERLAP_ROTATION_STEP_DEGREES = 15;

/** Radians added for each note after the first in one overlap stack. */
export const NOTE_OVERLAP_ROTATION_STEP = (NOTE_OVERLAP_ROTATION_STEP_DEGREES * Math.PI) / 180;

/** Rotation in radians for one note's overlap rank; an absent rank stays upright. */
export function noteOverlapRotation(rank: number | undefined): number {
  return (rank ?? 0) * NOTE_OVERLAP_ROTATION_STEP;
}
