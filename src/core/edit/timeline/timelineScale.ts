/**
 * The timeline's vertical scale domain.
 *
 * The scale is the pixel length of one second at the active line's beat factor.
 * Its authored value, supported bounds, and clamp live here so the timeline
 * viewport, wheel zoom, toolbar controls, and the transport stretch bar all
 * describe the same range.
 */

/** The authored vertical timeline scale. */
export const TIMELINE_SCALE_DEFAULT = 500;

/** The smallest supported vertical timeline scale: 25% of the default. */
export const TIMELINE_SCALE_MIN = 125;

/** The largest supported vertical timeline scale: 400% of the default. */
export const TIMELINE_SCALE_MAX = 2000;

/**
 * Clamp a timeline scale while preserving a safe value for invalid settings.
 *
 * `fallback` is used only when `value` is not finite; a finite value outside the
 * range is clamped to the nearest bound.
 */
export function clampTimelineScale(value: number, fallback = TIMELINE_SCALE_DEFAULT): number {
  const safeFallback = Number.isFinite(fallback) ? fallback : TIMELINE_SCALE_DEFAULT;
  const candidate = Number.isFinite(value) ? value : safeFallback;
  return Math.max(TIMELINE_SCALE_MIN, Math.min(TIMELINE_SCALE_MAX, candidate));
}
