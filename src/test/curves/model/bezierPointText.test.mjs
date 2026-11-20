/**
 * The Bézier control-point draft: any text whose first four numbers form a
 * usable curve, with x normalized and y free to overshoot.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBezierPoints,
  parseBezierPointText,
} from "../../../design/components/easing/bezierPointText.ts";

test("the first four numbers of a paste become the control points", () => {
  assert.deepEqual(parseBezierPointText("0 0.753 0.389 1.3"), {
    valid: true,
    points: [0, 0.753, 0.389, 1.3],
  });
  assert.deepEqual(parseBezierPointText("0.71, 0.56, 0.221, 1.49"), {
    valid: true,
    points: [0.71, 0.56, 0.221, 1.49],
  });
  assert.deepEqual(parseBezierPointText("[0.1; 0.2; 0.9; 0.8] trailing words 5 6"), {
    valid: true,
    points: [0.1, 0.2, 0.9, 0.8],
  });
});

test("control-point search skips the digits inside coordinate labels", () => {
  assert.deepEqual(parseBezierPointText("x1=0.1 y1=-0.4 x2=0.9 y2=1.6"), {
    valid: true,
    points: [0.1, -0.4, 0.9, 1.6],
  });
});

test("x is clamped into the unit range and y may leave it", () => {
  assert.deepEqual(parseBezierPointText("2.3 2.55 2.11 2.21"), {
    valid: true,
    points: [1, 2.55, 1, 2.21],
  });
  assert.deepEqual(parseBezierPointText("-0.1 0 1.2 1"), {
    valid: true,
    points: [0, 0, 1, 1],
  });
  assert.deepEqual(parseBezierPointText("0 1.49 1 -0.75"), {
    valid: true,
    points: [0, 1.49, 1, -0.75],
  });
  assert.deepEqual(parseBezierPointText("0.71 0.56 0.221 1.49"), {
    valid: true,
    points: [0.71, 0.56, 0.221, 1.49],
  });
  assert.deepEqual(parseBezierPointText("0.5 0 0.5 1"), {
    valid: true,
    points: [0.5, 0, 0.5, 1],
  });
});

test("a draft without four numbers or with a non-finite number is rejected", () => {
  assert.deepEqual(parseBezierPointText(""), { valid: false, issue: "count" });
  assert.deepEqual(parseBezierPointText("0 0.5 1"), { valid: false, issue: "count" });
  assert.deepEqual(parseBezierPointText("0 0 1 1e999"), {
    valid: false,
    issue: "non-finite",
  });
});

test("formatting writes one space-separated line at three decimals", () => {
  assert.equal(formatBezierPoints([0, 0.7529, 0.3891, 1.3]), "0 0.753 0.389 1.3");
  assert.equal(formatBezierPoints([0.2, -1, 0.8, 2]), "0.2 -1 0.8 2");
  const text = formatBezierPoints([0, 0.5, 1, 1.49]);
  assert.deepEqual(parseBezierPointText(text), {
    valid: true,
    points: [0, 0.5, 1, 1.49],
  });
});
