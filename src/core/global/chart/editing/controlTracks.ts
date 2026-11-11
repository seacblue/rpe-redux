/**
 * Judge-line note-control curves.
 *
 * RPE stores five control tracks on each line. A point's `x` is note floor
 * distance, not chart time, so these helpers are deliberately separate from
 * tempo/event interpolation. The runtime evaluates the same shape in
 * `runtime/scene.ts`; the editor uses these helpers for its graph so it cannot
 * disagree with the preview about ordering, clamping, or easing.
 */
import type { ControlPoint } from "../chart.ts";
import { easing } from "../../../utils/easing.ts";

/** One control track's interpolated property. */
export type ControlCurveProperty = "alpha" | "pos" | "size" | "skew" | "y";

/** The visible graph range, with a neutral baseline included. */
export interface ControlCurveDomain {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Native RPE's sentinel endpoint; it should not dominate a practical view. */
const SENTINEL_X = 9_999_000;

/** The finite number stored on a point, or the track's neutral value. */
export function controlPointValue(
  point: ControlPoint | undefined,
  property: ControlCurveProperty,
  neutral: number,
): number {
  const value = Number(point?.[property]);
  return Number.isFinite(value) ? value : neutral;
}

/**
 * Interpolates one track at a floor distance.
 *
 * Points are sorted low-to-high. Values outside the endpoints clamp to the
 * nearest endpoint; a segment uses the ending point's `easing`, matching the
 * runtime and the chart format.
 */
export function controlTrackValue(
  points: readonly ControlPoint[],
  property: ControlCurveProperty,
  neutral: number,
  distance: number,
): number {
  const sorted = [...points].sort((left, right) => (left.x ?? 0) - (right.x ?? 0));
  if (!sorted.length) {
    return neutral;
  }
  const value = (point: ControlPoint) => controlPointValue(point, property, neutral);
  if (sorted.length === 1 || distance <= (sorted[0].x ?? 0)) {
    return value(sorted[0]);
  }
  for (let index = 1; index < sorted.length; index += 1) {
    const start = sorted[index - 1];
    const end = sorted[index];
    const startX = start.x ?? 0;
    const endX = end.x ?? 0;
    if (distance <= endX || index === sorted.length - 1) {
      const span = endX - startX;
      const progress = span === 0 ? 1 : Math.min(1, Math.max(0, (distance - startX) / span));
      return value(start) + (value(end) - value(start)) * easing(progress, end.easing ?? 1);
    }
  }
  return value(sorted[sorted.length - 1]);
}

/**
 * Chooses a readable graph window for one track.
 *
 * The synthetic `9_999_999` endpoint is excluded so a default neutral track
 * remains a practical 0–1000 range. Real authored points extend the window,
 * and a minimum span keeps a flat track from collapsing to a zero-height graph.
 */
export function controlTrackDomain(
  points: readonly ControlPoint[],
  property: ControlCurveProperty,
  neutral: number,
): ControlCurveDomain {
  const xs = points
    .map((point) => Number(point.x))
    .filter((x) => Number.isFinite(x) && Math.abs(x) < SENTINEL_X);
  let minX = Math.min(0, ...xs);
  let maxX = Math.max(1000, ...xs);
  if (maxX - minX < 10) {
    maxX = minX + 10;
  }
  const padX = (maxX - minX) * 0.08;
  minX -= padX;
  maxX += padX;

  const values = points.map((point) => controlPointValue(point, property, neutral));
  let minY = Math.min(neutral, ...values);
  let maxY = Math.max(neutral, ...values);
  const minimumSpan = property === "skew" ? 16 : 0.5;
  if (maxY - minY < minimumSpan) {
    const middle = (maxY + minY) / 2;
    minY = middle - minimumSpan / 2;
    maxY = middle + minimumSpan / 2;
  }
  const padY = (maxY - minY) * 0.12;
  minY -= padY;
  maxY += padY;
  return { minX, maxX, minY, maxY };
}
