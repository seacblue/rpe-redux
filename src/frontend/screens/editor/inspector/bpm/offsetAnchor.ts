/**
 * The audio position that keeps one chart position fixed across an offset edit.
 *
 * `META.offset` maps chart time onto the audio clock as `audio = chart + offset`,
 * so a committed offset only applies to the running transport once the audio
 * position moves with it. Callers read the chart position before the commit,
 * because that mapping changes with the new value. Returns null when either term
 * is not finite, which leaves the transport untouched.
 */
export function offsetAnchorSeconds(chartSeconds: number, offsetSeconds: number): number | null {
  const anchor = chartSeconds + offsetSeconds;
  if (
    !Number.isFinite(chartSeconds) ||
    !Number.isFinite(offsetSeconds) ||
    !Number.isFinite(anchor)
  ) {
    return null;
  }
  return anchor;
}
