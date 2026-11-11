/**
 * Long-press charge model for the daily fortune draw.
 *
 * The checked-in action is a hold: while the pointer or a key stays down the
 * charge rises to one, and after the draw completes or the press is released it
 * drains back to zero. The model is pure and frame based so the animation loop,
 * the liquid height, and the tests all read one definition.
 */

/** Milliseconds a continuous press needs to fill the charge. */
export const HOLD_DURATION_MS = 1000;

/** Milliseconds a released charge takes to drain; slower than the fill. */
export const HOLD_DRAIN_MS = 1600;

/** Milliseconds the liquid takes to clear once the draw itself is revealed. */
export const REVEAL_DRAIN_MS = 380;

/** Largest card offset of the charge vibration, in pixels. */
export const HOLD_SHAKE_OFFSET_PX = 0.8;

/** Largest card rotation of the charge vibration, in degrees. */
export const HOLD_SHAKE_ROTATE_DEG = 0.08;

/** Card offsets for one vibration frame. */
export interface HoldShake {
  x: number;
  y: number;
  rotate: number;
}

/**
 * Visible fill fraction for a charge.
 *
 * The body follows an ease-in curve: the rise starts slowly and accelerates into
 * the draw threshold, so the press reads as liquid gathering instead of a linear
 * progress bar. The charge itself stays linear so the patience the hold asks for,
 * the vibration envelope, and the drain durations stay unchanged.
 *
 * @param charge Current charge in the closed 0…1 range; out-of-range or
 *   non-finite values clamp to zero.
 */
export function holdFillFraction(charge: number): number {
  const value = Number.isFinite(charge) ? Math.min(1, Math.max(0, charge)) : 0;
  return value * value;
}

/**
 * Vibration of the card while the draw charges.
 *
 * The envelope grows with the charge raised to 1.5, so the movement stays
 * imperceptible at the start of the press and only becomes a faint tremble near
 * the draw threshold. The three waves use unrelated frequencies so the result
 * reads as a shaky hand instead of a metronome.
 *
 * @param fill Current charge in the closed 0…1 range; out-of-range or
 *   non-finite values clamp to zero, which removes the vibration.
 * @param elapsedMs Milliseconds since the press started; non-finite values count
 *   as the first frame so the card never jumps on a throttled frame.
 */
export function holdShake(fill: number, elapsedMs: number): HoldShake {
  const charge = Number.isFinite(fill) ? Math.min(1, Math.max(0, fill)) : 0;
  const time = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const strength = charge * Math.sqrt(charge);
  const offset = HOLD_SHAKE_OFFSET_PX * strength;
  return {
    x: offset * (Math.sin(time * 0.094) * 0.62 + Math.sin(time * 0.151 + 1.3) * 0.38),
    y: offset * 0.72 * Math.sin(time * 0.127 + 2.1),
    rotate: HOLD_SHAKE_ROTATE_DEG * strength * Math.sin(time * 0.083 + 0.6),
  };
}

/**
 * Advance the press charge by one frame.
 *
 * @param fill Current charge in the closed 0…1 range.
 * @param elapsedMs Milliseconds since the previous frame; non-positive or
 *   non-finite values leave the charge unchanged so a throttled frame cannot
 *   skip or rewind it.
 * @param holding Whether the press is still active this frame.
 * @param drainMs Duration of a released drain; the reveal uses a shorter one
 *   so the reading does not sit behind a full card of liquid.
 * @returns The next charge, clamped to 0…1.
 */
export function advanceHoldFill(
  fill: number,
  elapsedMs: number,
  holding: boolean,
  drainMs = HOLD_DRAIN_MS,
): number {
  const current = Number.isFinite(fill) ? Math.min(1, Math.max(0, fill)) : 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return current;
  }
  const duration = holding ? HOLD_DURATION_MS : Math.max(1, drainMs);
  const step = (holding ? elapsedMs : -elapsedMs) / duration;
  return Math.min(1, Math.max(0, current + step));
}
