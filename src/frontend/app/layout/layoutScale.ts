/**
 * The host and viewport factors the shell's panel sizes multiply by.
 *
 * The authored panel sizes are a desktop baseline, and every host now paints
 * them 25% larger so a single default fits both the app window and a browser
 * page. Both hosts follow the window or page size directly: the viewport factor
 * is the smaller dimension's share of the reference window, with no lower or
 * upper clamp. A wide but short window therefore stays inside the height it has
 * to fit instead of outgrowing it.
 */

/** The scale every host paints the authored chrome at. */
export const LAYOUT_HOST_SCALE = 1.25;

/** The window the authored chrome is measured against. */
export const LAYOUT_REFERENCE_WIDTH = 1440;
export const LAYOUT_REFERENCE_HEIGHT = 900;

/**
 * The host factor for a desktop or browser page.
 *
 * Both hosts share one factor, so the same profile paints one size whether it
 * runs in the app window or in a browser tab.
 */
export function hostLayoutScale(): number {
  return LAYOUT_HOST_SCALE;
}

/**
 * The continuous window or page factor.
 *
 * The smaller of the two dimension shares wins, so a window that is wide but
 * short does not grow the chrome past the height it has to fit. The share is used
 * as written, with no authored band: doubling the window doubles the chrome and
 * halving it halves the chrome. A missing size reads as the reference.
 */
export function viewportLayoutScale(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) {
    return 1;
  }
  return Math.min(width / LAYOUT_REFERENCE_WIDTH, height / LAYOUT_REFERENCE_HEIGHT);
}
