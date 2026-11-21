/**
 * Verifies the easing canvases share one responsive sizing and axis contract.
 *
 * Progress runs along the horizontal axis so a bound at 0.18 always sits at 18%
 * of the frame's width; the curve's output sets the height. The value domain only
 * labels the ends, it does not position anything.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { easing } from "../../../core/utils/easing.ts";
import {
  EASING_CANVAS_HEIGHT,
  EASING_CANVAS_WIDTH,
  EASING_PLOT,
  easingCanvasMetrics,
  easingOutputY,
  easingPreviewCurve,
  easingPreviewValue,
  easingPreviewValueDomain,
  easingPreviewX,
  easingProgressX,
} from "../../../design/components/easing/easingCanvas.ts";

test("a ratio-matched wide preview uses equal logical scales", () => {
  const metrics = easingCanvasMetrics(450, 450 / (EASING_CANVAS_WIDTH / EASING_CANVAS_HEIGHT), 2);
  assert.equal(metrics.pixelWidth, 900);
  assert.equal(metrics.pixelHeight, 346);
  assert.ok(Math.abs(metrics.scaleX - metrics.scaleY) < 0.01);
});

test("the shared canvas sizing caps device-pixel work", () => {
  const metrics = easingCanvasMetrics(260, 100, 4);
  assert.deepEqual(metrics, {
    pixelWidth: 520,
    pixelHeight: 200,
    scaleX: 2,
    scaleY: 2,
  });
});

test("progress is linear along the frame's width", () => {
  assert.equal(easingProgressX(0), EASING_PLOT.left);
  assert.equal(easingProgressX(1), EASING_PLOT.right);
  assert.equal(easingProgressX(0.5), (EASING_PLOT.left + EASING_PLOT.right) / 2);
  // The whole point of the linear axis: 0.18 is 18% across, not "wherever the
  // Quart curve happens to be at 18%".
  assert.equal(
    easingProgressX(0.18),
    EASING_PLOT.left + 0.18 * (EASING_PLOT.right - EASING_PLOT.left),
  );
  assert.equal(
    easingProgressX(0.14),
    EASING_PLOT.left + 0.14 * (EASING_PLOT.right - EASING_PLOT.left),
  );
});

test("no curve shifts where a bound sits", () => {
  // The bound's guide must not move with the selected curve. If it did, the
  // preview would place 0.18 at easing(0.18) for Quart but elsewhere for Linear,
  // and the two sliders would disagree with the picture.
  const expected = EASING_PLOT.left + 0.18 * (EASING_PLOT.right - EASING_PLOT.left);
  for (const type of [1, 2, 5, 10, 21, 29]) {
    assert.equal(easingProgressX(0.18), expected, `type ${type} must not move the guide`);
  }
  // Quart genuinely does place 0.18 at 54.8%, which is why reading the guide off
  // easing(0.18) made the two bounds look non-linear.
  assert.ok(Math.abs(easing(0.18, 10, 0, 1) - 0.548) < 0.001);
});

test("the curve's output sets the height", () => {
  assert.equal(easingOutputY(0), EASING_PLOT.bottom);
  assert.equal(easingOutputY(1), EASING_PLOT.top);
  assert.equal(easingOutputY(0.5), (EASING_PLOT.top + EASING_PLOT.bottom) / 2);
});

test("the value axis only labels the ends", () => {
  const domain = easingPreviewValueDomain(0, -3);

  // A descending transition still labels its minimum on the left; the labels are
  // what the numeric endpoints are for, and they no longer move the curve.
  assert.equal(easingPreviewX(domain, easingPreviewValue(domain, 0)), EASING_PLOT.right);
  assert.equal(easingPreviewX(domain, easingPreviewValue(domain, 1)), EASING_PLOT.left);
  assert.equal(easingPreviewValue(domain, 0), 0);
  assert.equal(easingPreviewValue(domain, 1), -3);
  assert.equal(easingPreviewValue(domain, 0.75), -2.25);
});

test("reversed bounds draw the segment the renderer samples", () => {
  const reversed = easingPreviewCurve(2, 0.85, 0.61);
  const uncut = easingPreviewCurve(2, 0, 1);

  for (const progress of [0.25, 0.5, 0.75]) {
    assert.ok(
      Math.abs(reversed(progress) - easing(progress, 2, 0.85, 0.61)) < 1e-12,
      `reversed preview must match the renderer at ${progress}`,
    );
    assert.ok(
      Math.abs(reversed(progress) - uncut(progress)) > 1e-3,
      `reversed preview must not flatten to the uncut curve at ${progress}`,
    );
  }
  assert.ok(
    Math.abs(reversed(0)) < 1e-12 && Math.abs(reversed(1) - 1) < 1e-12,
    "reversed bounds still map the endpoints onto the event endpoints",
  );
});

test("equal bounds fall back to linear progress like the renderer", () => {
  const flat = easingPreviewCurve(2, 0.5, 0.5);

  for (const progress of [0, 0.3, 0.7, 1]) {
    assert.equal(flat(progress), progress);
  }
});
