/**
 * Shared responsive canvas sizing for the easing previews.
 *
 * Both previews draw in the same 260x100 logical space. Keeping the backing
 * store and transform in one place prevents a wide inspector from stretching
 * one curve differently from the other and keeps high-DPI output crisp.
 */
export const EASING_CANVAS_WIDTH = 260;
export const EASING_CANVAS_HEIGHT = 100;
export const EASING_PLOT_LEFT = 10;
export const EASING_PLOT_RIGHT = EASING_CANVAS_WIDTH - EASING_PLOT_LEFT;

/** The numeric value domain used by one easing preview. */
export interface EasingPreviewValueDomain {
  start: number;
  end: number;
  minimum: number;
  maximum: number;
}

/**
 * Resolve the horizontal value domain for a preview.
 *
 * The x axis is numeric value ordered from left to right, not event time.
 * Consequently a transition from `0` to `-3` travels from the right edge to
 * the left edge. Missing or non-finite endpoints use the normalized `0..1`
 * domain used by generic easing previews.
 */
export function easingPreviewValueDomain(
  startValue?: number,
  endValue?: number,
): EasingPreviewValueDomain {
  const start = Number.isFinite(startValue) ? Number(startValue) : 0;
  const end = Number.isFinite(endValue) ? Number(endValue) : 1;
  if (start === end) {
    return { start, end, minimum: start - 0.5, maximum: end + 0.5 };
  }
  return {
    start,
    end,
    minimum: Math.min(start, end),
    maximum: Math.max(start, end),
  };
}

/** Interpolate one actual event value from a normalized easing output. */
export function easingPreviewValue(
  domain: EasingPreviewValueDomain,
  easedProgress: number,
): number {
  const amount = Number.isFinite(easedProgress) ? easedProgress : 0;
  return domain.start + (domain.end - domain.start) * amount;
}

/** Map one actual event value onto the numeric value axis. */
export function easingPreviewX(domain: EasingPreviewValueDomain, value: number): number {
  const actualValue = Number.isFinite(value) ? value : domain.start;
  return (
    EASING_PLOT_LEFT +
    ((actualValue - domain.minimum) / (domain.maximum - domain.minimum)) *
      (EASING_PLOT_RIGHT - EASING_PLOT_LEFT)
  );
}

export interface EasingCanvasMetrics {
  pixelWidth: number;
  pixelHeight: number;
  scaleX: number;
  scaleY: number;
}

/** Calculate backing-store dimensions and logical drawing scales. */
export function easingCanvasMetrics(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio = globalThis.devicePixelRatio || 1,
): EasingCanvasMetrics {
  const width = Math.max(1, cssWidth || EASING_CANVAS_WIDTH);
  const height = Math.max(1, cssHeight || EASING_CANVAS_HEIGHT);
  const pixelScale = Math.min(2, Math.max(1, devicePixelRatio));
  const pixelWidth = Math.max(2, Math.round(width * pixelScale));
  const pixelHeight = Math.max(2, Math.round(height * pixelScale));
  return {
    pixelWidth,
    pixelHeight,
    scaleX: pixelWidth / EASING_CANVAS_WIDTH,
    scaleY: pixelHeight / EASING_CANVAS_HEIGHT,
  };
}

/** Resize one preview canvas to its CSS box and return its logical scales. */
export function resizeEasingCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): EasingCanvasMetrics {
  const metrics = easingCanvasMetrics(cssWidth, cssHeight);
  if (canvas.width !== metrics.pixelWidth || canvas.height !== metrics.pixelHeight) {
    canvas.width = metrics.pixelWidth;
    canvas.height = metrics.pixelHeight;
  }
  return metrics;
}
