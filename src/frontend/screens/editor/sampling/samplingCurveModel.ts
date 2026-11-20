/**
 * The one curve model shared by the event inspector and both sampling surfaces.
 *
 * A displayed Bézier always has four finite control points whose x coordinates
 * lie inside `[0, 1]`. Missing, malformed, or out-of-range stored points open on
 * the identity curve so every entry point draws the same usable editor instead
 * of preserving a shape the renderer cannot evaluate. The x pair may repeat or
 * decrease: both are valid cubic Bézier shapes (RPE authors them) and the
 * renderer resolves progress from x as long as each x stays inside the unit
 * interval.
 */
import { clamp01 } from "../../../../core/utils/numbers.ts";

/** The identity cubic Bézier used when stored control points are unusable. */
export const IDENTITY_BEZIER_POINTS = [0, 0, 1, 1] as const;

/** Why stored control points are not usable. */
export type BezierPointIssue = "shape" | "non-finite" | "x-range";

/** The normalized control points plus, when rejected, the reason. */
export type BezierPointValidation =
  { valid: true; points: number[] } | { valid: false; points: number[]; issue: BezierPointIssue };

/** A fresh identity curve. */
function identityPoints(): number[] {
  return [...IDENTITY_BEZIER_POINTS];
}

/** A rejected result that still carries the curve the editor will draw. */
function rejected(issue: BezierPointIssue): BezierPointValidation {
  return { valid: false, points: identityPoints(), issue };
}

/**
 * Validate stored Bézier control points.
 *
 * The list must hold four finite numbers and both x coordinates must lie inside
 * `[0, 1]`, which keeps x a monotonic function of the curve parameter. Rejected
 * points return the identity curve.
 */
export function validateBezierPoints(points: unknown): BezierPointValidation {
  if (!Array.isArray(points) || points.length !== 4) {
    return rejected("shape");
  }
  if (!points.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return rejected("non-finite");
  }
  const [firstX, , secondX] = points as number[];
  if (firstX < 0 || firstX > 1 || secondX < 0 || secondX > 1) {
    return rejected("x-range");
  }
  return { valid: true, points: [...(points as number[])] };
}

/**
 * The control points the editor may draw.
 *
 * Valid stored points are copied; every other shape falls back to the identity
 * curve. This is the single reader all three curve entry points use.
 */
export function usableBezierPoints(points: unknown): number[] {
  return validateBezierPoints(points).points;
}

/** One easing range bound as a finite value inside `[0, 1]`. */
export function normalizeEasingBound(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : fallback;
}

/** The curve fields an event or a sampling draft stores. */
export interface StoredCurveValues {
  bezier?: unknown;
  bezierPoints?: unknown;
  easingLeft?: unknown;
  easingRight?: unknown;
}

/** The normalized values the shared curve editor renders. */
export interface CurveValues {
  bezier: boolean;
  bezierPoints: number[];
  easingLeft: number;
  easingRight: number;
}

/**
 * Read one stored curve into the shape the editor consumes.
 *
 * Every entry point calls this, so an event and a sampling draft with the same
 * fields produce the same mode flag, control points, and range bounds.
 */
export function resolveCurveValues(values: StoredCurveValues): CurveValues {
  return {
    bezier: Boolean(values.bezier),
    bezierPoints: usableBezierPoints(values.bezierPoints),
    easingLeft: normalizeEasingBound(values.easingLeft, 0),
    easingRight: normalizeEasingBound(values.easingRight, 1),
  };
}
