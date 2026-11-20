/**
 * The text form of one Bézier control-point set.
 *
 * The inspector edits `[x1, y1, x2, y2]` as one draft so a pasted RPE
 * control-point line can be copied and corrected as a whole. The parser scans
 * the draft for numbers in order: the first four are the control points and the
 * rest is ignored, which is what lets a paste carry separators or trailing
 * commentary. Each x is clamped into `[0, 1]` because the chart evaluates the
 * curve as a function of progress; y is any finite number, matching the
 * overshoot RPE authors.
 */
import { clamp01 } from "../../../core/utils/numbers.ts";

/** Why a control-point draft does not describe a usable curve. */
export type BezierPointTextIssue = "count" | "non-finite";

/** The four control points a draft defines, or the reason it does not. */
export type BezierPointTextResult =
  { valid: true; points: number[] } | { valid: false; issue: BezierPointTextIssue };

/**
 * One decimal number, including a sign, a leading dot, and an exponent.
 *
 * The boundaries keep the digit of a label such as `x1` or `y2` out of the
 * result, so a paste that carries coordinate names still yields four values.
 */
const NUMBER = /(?<![\w.])-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?![\w.])/gu;

/** Format one coordinate with the field's three-decimal precision. */
function formatCoordinate(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** Format four control points as one space-separated draft. */
export function formatBezierPoints(points: readonly number[]): string {
  return points.slice(0, 4).map(formatCoordinate).join(" ");
}

/**
 * Read a draft as its first four numbers and sanity-convert them.
 *
 * A draft with fewer than four numbers or a non-finite number is rejected.
 * Otherwise each x is clamped into `[0, 1]` and y is accepted as written; the x
 * pair may repeat or decrease the way RPE authors it.
 */
export function parseBezierPointText(text: string): BezierPointTextResult {
  const numbers = (text.match(NUMBER) ?? []).map(Number);
  if (numbers.length < 4) {
    return { valid: false, issue: "count" };
  }
  const points = numbers.slice(0, 4);
  if (!points.every(Number.isFinite)) {
    return { valid: false, issue: "non-finite" };
  }
  return {
    valid: true,
    points: [clamp01(points[0]), points[1], clamp01(points[2]), points[3]],
  };
}
