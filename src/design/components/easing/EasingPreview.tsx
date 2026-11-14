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
 * Sampling uses the same `easing`/`bezier` functions the renderer uses, so the
 * drawing cannot drift from the animation. The base curve is sampled with no
 * bounds (`easing(t, type, 0, 1)`) on purpose: the bounds select a sub-range of
 * that curve, and drawing the composed value would hide which segment was cut.
 */
import { useEffect, useRef, useState } from "react";
import { bezier, easing } from "../../../core/utils/easing.ts";
import { clamp01 } from "../../../core/utils/numbers.ts";
import {
  EASING_CANVAS_HEIGHT,
  EASING_CANVAS_WIDTH,
  EASING_PLOT_LEFT,
  EASING_PLOT_RIGHT,
  easingPreviewValue,
  easingPreviewValueDomain,
  easingPreviewX,
  resizeEasingCanvas,
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
const TOP = 12;
const BOTTOM = 88;
const PLOT_WIDTH = EASING_PLOT_RIGHT - EASING_PLOT_LEFT;

const yOfProgress = (progress: number): number => BOTTOM - progress * (BOTTOM - TOP);

/** Stroke one sampled segment of a curve into the canvas. */
function drawCurve(
  draw: CanvasRenderingContext2D,
  from: number,
  to: number,
  curve: (progress: number) => number,
  xOfEasedValue: (easedProgress: number) => number,
): void {
  draw.beginPath();
  for (let index = 0; index <= 120; index++) {
    const progress = from + ((to - from) * index) / 120;
    const easedProgress = curve(progress);
    if (!Number.isFinite(easedProgress)) {
      continue;
    }
    if (index === 0) {
      draw.moveTo(xOfEasedValue(easedProgress), yOfProgress(progress));
    } else {
      draw.lineTo(xOfEasedValue(easedProgress), yOfProgress(progress));
    }
  }
  draw.stroke();
}

/** Draws the easing curve, its active bounds, and its control points for one event. */
export function EasingPreview({ event }: { event: EasingPreviewEvent }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawVersion, setDrawVersion] = useState(0);
  const {
    bezier: isBezier,
    bezierPoints,
    easingType,
    easingLeft,
    easingRight,
    startValue,
    endValue,
  } = event;

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
    const draw = canvas?.getContext("2d");
    if (!canvas || !draw) {
      return;
    }
    const style = getComputedStyle(canvas);
    const accent = style.getPropertyValue("--accent").trim();
    const quiet = style.getPropertyValue("--foreground-muted").trim();
    if (!accent || !quiet) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const valueDomain = easingPreviewValueDomain(startValue, endValue);
    const xOfEasedValue = (easedProgress: number) =>
      easingPreviewX(valueDomain, easingPreviewValue(valueDomain, easedProgress));
    const { pixelWidth, pixelHeight, scaleX, scaleY } = resizeEasingCanvas(
      canvas,
      rect.width || WIDTH,
      rect.height || HEIGHT,
    );
    draw.setTransform(1, 0, 0, 1, 0, 0);
    draw.clearRect(0, 0, pixelWidth, pixelHeight);
    draw.setTransform(scaleX, 0, 0, scaleY, 0, 0);

    // The unit range is the closed frame; overshooting curves remain visible in
    // the breathing room outside it without making any frame edge protrude.
    draw.strokeStyle = quiet;
    draw.lineWidth = 1;
    draw.setLineDash([2, 3]);
    draw.strokeRect(EASING_PLOT_LEFT, TOP, PLOT_WIDTH, BOTTOM - TOP);
    draw.setLineDash([]);

    if (isBezier) {
      const points = bezierPoints ?? [];
      draw.strokeStyle = quiet;
      draw.setLineDash([3, 3]);
      draw.beginPath();
      draw.moveTo(xOfEasedValue(0), yOfProgress(0));
      draw.lineTo(xOfEasedValue(points[1] ?? 0), yOfProgress(points[0] ?? 0));
      draw.moveTo(xOfEasedValue(1), yOfProgress(1));
      draw.lineTo(xOfEasedValue(points[3] ?? 1), yOfProgress(points[2] ?? 1));
      draw.stroke();
      draw.setLineDash([]);
      draw.strokeStyle = accent;
      draw.lineWidth = 2;
      drawCurve(draw, 0, 1, (progress) => bezier(progress, points), xOfEasedValue);
      return;
    }

    const left = clamp01(easingLeft ?? 0);
    const right = clamp01(easingRight ?? 1);
    const type = easingType ?? 1;
    const baseCurve = (progress: number) => easing(progress, type, 0, 1);
    const activeCurve = (progress: number) =>
      right > left ? easing(progress, type, left, right) : baseCurve(progress);
    draw.strokeStyle = quiet;
    draw.lineWidth = 1.5;
    drawCurve(draw, 0, 1, baseCurve, xOfEasedValue);
    // The active event curve is normalized back to its actual start/end values.
    draw.strokeStyle = accent;
    draw.lineWidth = 2;
    drawCurve(draw, 0, 1, activeCurve, xOfEasedValue);
    if (right > left) {
      draw.strokeStyle = quiet;
      draw.lineWidth = 1;
      draw.setLineDash([3, 3]);
      for (const boundary of [left, right]) {
        if (boundary <= 0 || boundary >= 1) {
          continue;
        }
        draw.beginPath();
        draw.moveTo(xOfEasedValue(baseCurve(boundary)), TOP);
        draw.lineTo(xOfEasedValue(baseCurve(boundary)), BOTTOM);
        draw.stroke();
      }
      draw.setLineDash([]);
    }
  }, [
    drawVersion,
    isBezier,
    bezierPoints,
    easingType,
    easingLeft,
    easingRight,
    startValue,
    endValue,
  ]);

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
