/**
 * The host and viewport factors the shell's panel sizes multiply by.
 *
 * The authored panel sizes are a desktop baseline. The web build draws them a
 * quarter larger, because a page in a browser is the whole window rather than an
 * app frame, and both hosts follow the window or page size directly: the viewport
 * factor is the smaller dimension's share of the reference window, with no lower
 * or upper clamp. A wide but short window therefore stays inside the height it
 * has to fit instead of outgrowing it.
 */

/** The extra scale the browser build paints at. */
export const WEB_LAYOUT_SCALE = 1.25;

/** The window the authored chrome is measured against. */
export const LAYOUT_REFERENCE_WIDTH = 1440;
export const LAYOUT_REFERENCE_HEIGHT = 900;

/**
 * The host factor for a desktop or browser page.
 *
 * The desktop app keeps the authored baseline; the web build is a quarter larger
 * at every window size, so the two hosts stay in the same proportion.
 */
export function hostLayoutScale(desktop: boolean): number {
  return desktop ? 1 : WEB_LAYOUT_SCALE;
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
