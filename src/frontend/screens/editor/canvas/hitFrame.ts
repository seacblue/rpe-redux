/** Shared hit-animation clock used by preview drawing and note-skin rendering. */

/** How long one hit-animation frame lasts, in seconds. */
export const HIT_FRAME_SECONDS = 0.015;
/** How many frames a hit animation runs for. */
export const HIT_FRAME_COUNT = 32;
/** Total duration of a hit animation, in seconds. */
export const HIT_DURATION = HIT_FRAME_SECONDS * HIT_FRAME_COUNT;

/** Phira's default hit-effect duration in seconds. */
export const HIT_FX_DURATION_DEFAULT = 0.5;

/**
 * Which animation frame an effect of the given age is on, 1-based.
 *
 * `null` means "no effect is playing": the age is negative (the hit has not
 * happened yet) or the animation has already finished. Phira spreads the
 * frames over `hitFxDuration`; the fixed frame clock is only a fallback.
 */
export function hitFrame(
  age: number,
  frameCount = HIT_FRAME_COUNT,
  duration = HIT_FRAME_SECONDS * frameCount,
): number | null {
  const count = Math.max(0, Math.floor(frameCount));
  return age < 0 || count === 0 || duration <= 0 || age >= duration
    ? null
    : Math.min(count, Math.floor((age / duration) * count) + 1);
}
