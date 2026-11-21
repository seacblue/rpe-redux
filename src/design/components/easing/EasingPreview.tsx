/**
 * Canvas drawing of one easing curve, independent of the shipped curve images.
 *
 * The picture answers three questions at once: which family the curve belongs to,
 * which part of it the left/right bounds cut out (the bright segment, with the
 * discarded part dimmed), and — when Bézier is on — what the control points draw.
 * Its horizontal axis is numeric value ordered from left to right and its
 * vertical axis is transition progress from bottom to top. Each point uses the
 * actual interpolation `start + (end - start) * easedProgress`, so a descending
 * `0 → -3` transition runs from the right edge to the left edge. Without
 * endpoints it falls back to the normalized `0..1` value domain.
 *
 * This component owns sampling only. The frame, the overshoot fade, and the axis
 * labels come from `easingCanvas.ts`, which the Bézier editor paints through as
 * well, so the two previews cannot drift apart.
 *
 * Sampling uses the same `easing`/`bezier` functions the renderer uses, so the
 * drawing cannot drift from the animation. The base curve is sampled with no
 * bounds (`easing(t, type, 0, 1)`) on purpose: the bounds select a sub-range of
 * that curve, and drawing the composed value would hide which segment was cut.
 * A reversed sub-range (`left > right`) is drawn like the renderer samples it,
 * as the selected segment walked backwards, rather than as the uncut curve.
 */
import { useEffect, useRef, useState } from "react";
import { bezier, easing } from "../../../core/utils/easing.ts";
import { clamp01 } from "../../../core/utils/numbers.ts";
import {
  EASING_CANVAS_HEIGHT,
  EASING_CANVAS_WIDTH,
  EASING_GUIDE_ALPHA,
  EASING_PLOT,
  drawEasingFrame,
  easingOutputY,
  easingProgressX,
  prepareEasingCanvas,
  strokeEasingPolyline,
  type EasingPolyline,
} from "./easingCanvas.ts";

/**
 * Only the fields the preview draws. Naming the shape here keeps chart-model
 * knowledge out of the design layer: a caller passes its own event and it is
 * structurally compatible, without `src/design/` importing `core/global/chart/`.
 */
interface EasingPreviewEvent {
  // Mirrors the chart model's own field types (`bezier` is a 0/1 flag there),
  // so a caller can pass its event unchanged.
  bezier?: number | boolean;
  bezierPoints?: readonly number[];
  easingType?: number;
  easingLeft?: number;
  easingRight?: number;
  startValue?: number;
  endValue?: number;
}

const WIDTH = EASING_CANVAS_WIDTH;
const HEIGHT = EASING_CANVAS_HEIGHT;
/** Segments sampled across the transfer; enough for the sharpest bounce curve. */
const SEGMENTS = 96;

/**
 * Sample one transfer into the plot's logical space.
 *
 * Progress runs along the horizontal axis from `0` to `1`, and the curve's
 * output sets the height. This is the shape an easing field is read as, so a
 * bound at `0.18` sits at 18% of the frame's width no matter which curve is
 * selected.
 */
function sampleTransfer(
  transfer: (progress: number) => number,
  style: EasingPolyline["style"],
): EasingPolyline {
  const points: number[] = [];
  for (let index = 0; index <= SEGMENTS; index++) {
    const progress = index / SEGMENTS;
    const eased = transfer(progress);
    if (!Number.isFinite(eased)) {
      continue;
    }
    points.push(easingProgressX(progress, EASING_PLOT), easingOutputY(eased, EASING_PLOT));
  }
  return { points, style };
}

/** Draws the easing curve, its active bounds, and its discarded segment. */
export function EasingPreview({ event }: { event: EasingPreviewEvent }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawVersion, setDrawVersion] = useState(0);
  const { bezier: isBezier, bezierPoints, easingType, easingLeft, easingRight } = event;

  useEffect(() => {
    const redraw = () => setDrawVersion((version) => version + 1);
    window.addEventListener("redux-theme", redraw);
    const canvas = canvasRef.current;
    const observer =
      canvas && typeof ResizeObserver !== "undefined" ? new ResizeObserver(redraw) : null;
    if (observer && canvas) {
      observer.observe(canvas);
    }
    redraw();
    return () => {
      window.removeEventListener("redux-theme", redraw);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const surface = canvas ? prepareEasingCanvas(canvas) : null;
    if (!canvas || !surface) {
      return;
    }
    const { context, palette, plot } = surface;

    drawEasingFrame(surface);

    if (isBezier) {
      const points = bezierPoints ?? [];
      // The control handles are context for the curve, so they share the guide
      // weight rather than the curve's.
      context.save();
      context.strokeStyle = palette.guide;
      context.globalAlpha = EASING_GUIDE_ALPHA;
      context.lineWidth = 1;
      context.setLineDash([3, 3]);
      context.beginPath();
      context.moveTo(easingProgressX(0, plot), easingOutputY(0, plot));
      context.lineTo(easingProgressX(points[0] ?? 0, plot), easingOutputY(points[1] ?? 0, plot));
      context.moveTo(easingProgressX(1, plot), easingOutputY(1, plot));
      context.lineTo(easingProgressX(points[2] ?? 1, plot), easingOutputY(points[3] ?? 1, plot));
      context.stroke();
      context.restore();
      strokeEasingPolyline(
        surface,
        sampleTransfer((progress) => bezier(progress, points), "curve"),
        2,
      );
      return;
    }

    const type = easingType ?? 1;
    const left = clamp01(easingLeft ?? 0);
    const right = clamp01(easingRight ?? 1);
    // The family curve is what the bounds are read against: the animation plays
    // the segment between them and discards the rest, so that segment is drawn
    // at full weight and everything else stays dim.
    strokeEasingPolyline(
      surface,
      {
        ...sampleTransfer((progress) => easing(progress, type, 0, 1), "curve"),
        highlight: { from: left, to: right },
      },
      2,
    );

    if (left !== right) {
      context.save();
      context.globalAlpha = EASING_GUIDE_ALPHA;
      context.lineWidth = 1;
      // Each bound keeps its own ink so the two sides stay distinguishable while
      // a drag sweeps one of them past the other.
      for (const [boundary, ink] of [
        [left, palette.leftBound],
        [right, palette.rightBound],
      ] as const) {
        if (boundary <= 0 || boundary >= 1) {
          continue;
        }
        // The bound is a progress value, so the guide stands at that share of the
        // frame's width rather than at the curve's height there.
        const x = easingProgressX(boundary, plot);
        context.strokeStyle = ink;
        context.beginPath();
        context.moveTo(x, plot.top);
        context.lineTo(x, plot.bottom);
        context.stroke();
      }
      context.restore();
    }
  }, [drawVersion, isBezier, bezierPoints, easingType, easingLeft, easingRight]);

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      className="easing-preview"
      aria-hidden="true"
    />
  );
}
