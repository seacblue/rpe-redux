/**
 * Shared geometry and curve sampling for the easing previews.
 *
 * Both previews draw in the same 260x100 logical space. Keeping the backing
 * store and transform in one place prevents a wide inspector from stretching
 * one curve differently from the other and keeps high-DPI output crisp. The
 * sampled sub-range lives here too, so the preview and the renderer read the
 * same easing function for every bound order.
 */
import { easing } from "../../../core/utils/easing.ts";
import { clamp01 } from "../../../core/utils/numbers.ts";

export const EASING_CANVAS_WIDTH = 260;
export const EASING_CANVAS_HEIGHT = 100;
export const EASING_PLOT_LEFT = 10;
export const EASING_PLOT_RIGHT = EASING_CANVAS_WIDTH - EASING_PLOT_LEFT;

/** The rectangle one preview paints its curve inside, in logical pixels. */
export interface EasingPlot {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The easing preview's plot.
 *
 * The easing preview prints the event's value bounds under the curve, so its
 * frame leaves a label band at the bottom. The Bézier editor prints no labels
 * and takes the taller plot instead, which is why the two do not share a rect.
 */
export const EASING_PLOT: EasingPlot = {
  left: EASING_PLOT_LEFT,
  top: 14,
  right: EASING_PLOT_RIGHT,
  bottom: 86,
};

/** The Bézier editor's plot: no label band, so the frame uses the full height. */
export const EASING_BEZIER_PLOT: EasingPlot = {
  left: EASING_PLOT_LEFT,
  top: 8,
  right: EASING_PLOT_RIGHT,
  bottom: 92,
};

/** Alpha of the solid frame both previews draw. */
export const EASING_FRAME_ALPHA = 0.16;

/** Alpha of the guides that mark bounds or control-point tangents. */
export const EASING_GUIDE_ALPHA = 0.5;

/**
 * Alpha of the uncut curve a preview reads the selected sub-range against.
 *
 * It is the lightest thing on the canvas apart from the frame: it answers "which
 * family is this" without competing with the curve the animation plays.
 */
export const EASING_REFERENCE_ALPHA = 0.22;

/** Alpha of a curve where it runs outside the frame. */
export const EASING_OVERSHOOT_ALPHA = 0.3;

/** Baseline of the value-axis labels under the frame. */
export const EASING_AXIS_LABEL_BASELINE = 98;

/** Font of the value-axis labels, in the plot's logical pixels. */
export const EASING_AXIS_LABEL_FONT = 9;

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

/**
 * Sample the sub-range one event's bounds select for the preview.
 *
 * The result is the same normalized curve the renderer samples, so the two
 * cannot disagree. Reversed bounds (`left > right`) remain valid: the runtime
 * normalizes the selected segment against its own endpoints, which walks the
 * sub-range backwards, and the preview draws that walk instead of falling back
 * to the uncut curve.
 */
export function easingPreviewCurve(
  type: number,
  left: number,
  right: number,
): (progress: number) => number {
  const start = clamp01(left);
  const end = clamp01(right);
  return (progress) => easing(progress, type, start, end);
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

/** The resolved theme colours one preview paints with. */
export interface EasingCanvasPalette {
  /** The curve being edited. */
  curve: string;
  /** Frames, tangents, and the discarded part of a curve. */
  guide: string;
  /** The two bounds that cut the curve, kept distinct so each side is readable. */
  leftBound: string;
  rightBound: string;
  /** Handle fill for the interaction states of a control point. */
  handle: string;
  handleHover: string;
  handleActive: string;
  fontFamily: string;
}

/** Read the palette off a canvas so both previews resolve the theme the same way. */
export function easingCanvasPalette(canvas: HTMLCanvasElement): EasingCanvasPalette {
  const style = getComputedStyle(canvas);
  const token = (name: string) => style.getPropertyValue(name).trim();
  const curve = token("--accent");
  const guide = token("--foreground-muted");
  const base = token("--foreground") || guide;
  return {
    curve,
    guide,
    leftBound: token("--canvas-easing-left-bound") || guide,
    rightBound: token("--canvas-easing-right-bound") || guide,
    handle: base,
    handleHover: token("--accent-hover") || curve || base,
    handleActive: token("--accent-pressed") || curve || base,
    fontFamily: style.fontFamily,
  };
}

/**
 * Alpha of the unit markers a preview draws inside the frame.
 *
 * These name the `-1` and `+1` limits a Bézier control point is read against,
 * and they only appear once a handle actually leaves that range: while the draft
 * is inside it the frame already says where the limits are.
 */
export const EASING_UNIT_ALPHA = 0.3;

/**
 * Draw the `y = +1` and `y = -1` limit lines, but only where one is needed.
 *
 * A control point may overshoot so far that the axis refits to fit it; the lines
 * then show how the plot compares to the limits the curve is meant to respect.
 * When the draft stays inside both limits no line is drawn, because the frame
 * edges already are those limits.
 */
export function drawEasingUnitLines(
  surface: EasingCanvasSurface,
  yOf: (value: number) => number,
  overshoot: readonly number[],
): void {
  const { context, palette, plot } = surface;
  const beyondHigh = overshoot.some((value) => value > 1);
  const beyondLow = overshoot.some((value) => value < -1);
  if (!beyondHigh && !beyondLow) {
    return;
  }
  context.save();
  context.strokeStyle = palette.guide;
  context.globalAlpha = EASING_UNIT_ALPHA;
  context.lineWidth = 1;
  context.setLineDash([2, 4]);
  for (const [needed, value] of [
    [beyondHigh, 1],
    [beyondLow, -1],
  ] as const) {
    if (!needed) {
      continue;
    }
    const y = yOf(value);
    if (y < plot.top || y > plot.bottom) {
      continue;
    }
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();
  }
  context.restore();
}

/**
 * Map normalized transition progress onto a plot's horizontal axis.
 *
 * Progress is linear across the frame, so a bound at `0.18` sits at 18% of the
 * width whatever curve is selected.
 */
export function easingProgressX(progress: number, plot: EasingPlot = EASING_PLOT): number {
  return plot.left + progress * (plot.right - plot.left);
}

/**
 * Map one normalized easing output onto a plot's vertical axis.
 *
 * Output `0` sits on the frame's bottom edge and `1` on its top, so the identity
 * curve runs corner to corner. A curve that overshoots continues past the frame
 * instead of being squashed into it.
 */
export function easingOutputY(output: number, plot: EasingPlot = EASING_PLOT): number {
  return plot.bottom - output * (plot.bottom - plot.top);
}

/**
 * One prepared drawing surface.
 *
 * `context` already carries the device-pixel transform and is cleared, so a
 * painter only maps its own coordinates. `plot` is the rectangle this canvas
 * paints inside; it differs between the two previews because the easing preview
 * reserves a band for its value labels and the Bézier editor does not.
 */
export interface EasingCanvasSurface {
  context: CanvasRenderingContext2D;
  palette: EasingCanvasPalette;
  plot: EasingPlot;
}

/** Prepare a canvas for one full repaint in the shared logical space. */
export function prepareEasingCanvas(
  canvas: HTMLCanvasElement,
  plot: EasingPlot = EASING_PLOT,
): EasingCanvasSurface | null {
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  const palette = easingCanvasPalette(canvas);
  if (!palette.curve || !palette.guide) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  const { pixelWidth, pixelHeight, scaleX, scaleY } = resizeEasingCanvas(
    canvas,
    rect.width || EASING_CANVAS_WIDTH,
    rect.height || EASING_CANVAS_HEIGHT,
  );
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, pixelWidth, pixelHeight);
  context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  context.lineJoin = "round";
  context.lineCap = "round";
  return { context, palette, plot };
}

/** Stroke the solid frame one preview stands on. */
export function drawEasingFrame(surface: EasingCanvasSurface): void {
  const { context, palette, plot } = surface;
  context.save();
  context.globalAlpha = EASING_FRAME_ALPHA;
  context.strokeStyle = palette.guide;
  context.lineWidth = 1;
  // Half-pixel inset keeps a one-pixel stroke on the pixel grid.
  context.strokeRect(
    plot.left + 0.5,
    plot.top + 0.5,
    plot.right - plot.left - 1,
    plot.bottom - plot.top - 1,
  );
  context.restore();
}

/** A curve sampled into the shared logical space. */
export interface EasingPolyline {
  /** Points in `[x, y]` pairs, in the plot's logical coordinates. */
  readonly points: readonly number[];
  /**
   * How the curve is painted.
   *
   * `curve` is the transfer the animation plays, drawn at full weight inside
   * `highlight` and dimmer everywhere else; `reference` is the uncut family
   * curve behind it; `guide` is layout geometry such as bounds and tangents.
   */
  readonly style: "curve" | "reference" | "guide";
  /**
   * The part of the curve the animation keeps, as normalized progress.
   *
   * Only `curve` reads it. Omitted means the whole curve is kept.
   */
  readonly highlight?: { readonly from: number; readonly to: number };
}

/**
 * Stroke one polyline at the weight its role asks for.
 *
 * A curve is drawn twice: once dim across its whole length, then again at full
 * weight inside both the frame and the kept progress range. Everything outside
 * that range — before the left bound, after the right bound, or past the frame
 * because the curve overshoots — stays at the dim weight.
 */
export function strokeEasingPolyline(
  surface: EasingCanvasSurface,
  polyline: EasingPolyline,
  lineWidth: number,
): void {
  const { context, palette } = surface;
  if (polyline.points.length < 4) {
    return;
  }
  const paint = () => {
    context.beginPath();
    context.moveTo(polyline.points[0], polyline.points[1]);
    for (let index = 2; index < polyline.points.length; index += 2) {
      context.lineTo(polyline.points[index], polyline.points[index + 1]);
    }
    context.stroke();
  };
  context.save();
  context.strokeStyle = polyline.style === "curve" ? palette.curve : palette.guide;
  context.lineWidth = lineWidth;
  if (polyline.style !== "curve") {
    context.globalAlpha =
      polyline.style === "reference" ? EASING_REFERENCE_ALPHA : EASING_GUIDE_ALPHA;
    paint();
    context.restore();
    return;
  }
  context.globalAlpha = EASING_OVERSHOOT_ALPHA;
  paint();
  context.save();
  // Each clip intersects the region already clipped, so the frame and the kept
  // progress range form one intersection rather than a union of two rectangles.
  const { plot } = surface;
  context.beginPath();
  context.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
  context.clip();
  const highlight = polyline.highlight;
  if (highlight) {
    // The kept range is a vertical slice of the plot: progress runs along x, so
    // the cut sits at the bound's own progress rather than at its eased value.
    const low = Math.max(0, Math.min(highlight.from, highlight.to));
    const high = Math.min(1, Math.max(highlight.from, highlight.to));
    const left = plot.left + low * (plot.right - plot.left);
    const right = plot.left + high * (plot.right - plot.left);
    context.beginPath();
    context.rect(left, plot.top, right - left, plot.bottom - plot.top);
    context.clip();
  }
  context.globalAlpha = 1;
  paint();
  context.restore();
  context.restore();
}
