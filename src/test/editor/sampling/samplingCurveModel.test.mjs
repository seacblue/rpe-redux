/**
 * The shared curve model: one Bézier validation rule and one normalized view for
 * the event inspector and both sampling surfaces.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  IDENTITY_BEZIER_POINTS,
  normalizeEasingBound,
  resolveCurveValues,
  usableBezierPoints,
  validateBezierPoints,
} from "../../../frontend/screens/editor/sampling/samplingCurveModel.ts";

test("bezier points require four finite numbers with x inside [0, 1]", () => {
  assert.deepEqual(usableBezierPoints([0.2, 0, 0.8, 1]), [0.2, 0, 0.8, 1]);
  assert.deepEqual(usableBezierPoints([0, 0, 1, 1]), [0, 0, 1, 1]);
  assert.deepEqual(usableBezierPoints([0.2, -1, 0.8, 2]), [0.2, -1, 0.8, 2]);
  // RPE authors the x pair in any order; only the unit interval matters.
  assert.deepEqual(usableBezierPoints([0.71, 0.56, 0.221, 1.49]), [0.71, 0.56, 0.221, 1.49]);
  assert.deepEqual(usableBezierPoints([0.8, 0, 0.2, 1]), [0.8, 0, 0.2, 1]);
  assert.deepEqual(usableBezierPoints([0.5, 0, 0.5, 1]), [0.5, 0, 0.5, 1]);

  for (const [points, issue] of [
    [undefined, "shape"],
    [null, "shape"],
    [[0, 0, 1], "shape"],
    [[0, 0, 1, 1, 1], "shape"],
    [[0, 0, Number.NaN, 1], "non-finite"],
    [[0, 0, "1", 1], "non-finite"],
    [[-0.1, 0, 0.8, 1], "x-range"],
    [[0.2, 0, 1.1, 1], "x-range"],
  ]) {
    const result = validateBezierPoints(points);
    assert.equal(result.valid, false);
    assert.equal(result.issue, issue);
    assert.deepEqual(result.points, [...IDENTITY_BEZIER_POINTS]);
    assert.deepEqual(usableBezierPoints(points), [...IDENTITY_BEZIER_POINTS]);
  }
});

test("repeated and reversed x pairs stay a usable curve", () => {
  for (const points of [
    [0, 0, 0, 1],
    [0.5, 0, 0.5, 1],
    [0.25, 0, 0.25, 0.75],
    [0.2, 0, 0.3, 0],
  ]) {
    assert.deepEqual(usableBezierPoints(points), points);
  }
});

test("range bounds normalize to finite values inside [0, 1]", () => {
  assert.equal(normalizeEasingBound(0.25, 0), 0.25);
  assert.equal(normalizeEasingBound(-1, 0), 0);
  assert.equal(normalizeEasingBound(2, 1), 1);
  assert.equal(normalizeEasingBound(undefined, 0), 0);
  assert.equal(normalizeEasingBound(Number.NaN, 1), 1);
  assert.equal(normalizeEasingBound(Number.POSITIVE_INFINITY, 0), 0);
});

test("a sampling draft and an event with the same curve fields resolve identically", () => {
  const stored = {
    bezier: 1,
    bezierPoints: [0.1, 0.2, 0.9, 0.8],
    easingLeft: 0.2,
    easingRight: 0.8,
  };
  const samplingDraft = resolveCurveValues(stored);
  const event = resolveCurveValues(stored);
  assert.deepEqual(samplingDraft, event);
  assert.deepEqual(samplingDraft, {
    bezier: true,
    bezierPoints: [0.1, 0.2, 0.9, 0.8],
    easingLeft: 0.2,
    easingRight: 0.8,
  });
});
