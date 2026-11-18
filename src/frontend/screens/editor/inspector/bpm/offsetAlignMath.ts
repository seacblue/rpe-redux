/**
 * The math behind aligning the chart offset to a timeline line.
 *
 * Aligning never moves the audio: the playhead keeps its audio position and the
 * chart slides so the picked line lands under it. That makes the target offset
 * `audio − chart`, because `chart = audio − offset`.
 */

/**
 * The offset, in milliseconds, that puts `chartSeconds` under `audioSeconds`.
 *
 * Returns null when either clock reading is unusable, which leaves the offset
 * untouched instead of committing a non-finite value.
 */
export function alignedOffsetMs(audioSeconds: number, chartSeconds: number): number | null {
  const offsetMs = (audioSeconds - chartSeconds) * 1000;
  if (
    !Number.isFinite(audioSeconds) ||
    !Number.isFinite(chartSeconds) ||
    !Number.isFinite(offsetMs)
  ) {
    return null;
  }
  return Math.round(offsetMs);
}
