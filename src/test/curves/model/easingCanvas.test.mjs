/** Verifies both easing canvases use one responsive, high-DPI sizing contract. */
import assert from "node:assert/strict";
import test from "node:test";
import { easing } from "../../../core/utils/easing.ts";
import {
  EASING_CANVAS_HEIGHT,
  EASING_CANVAS_WIDTH,
  EASING_PLOT_LEFT,
  EASING_PLOT_RIGHT,
  easingCanvasMetrics,
  easingPreviewValue,
  easingPreviewValueDomain,
  easingPreviewX,
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

test("the value axis places zero at the right for a 0-to-negative transition", () => {
  const domain = easingPreviewValueDomain(0, -3);

  assert.equal(easingPreviewX(domain, easingPreviewValue(domain, 0)), EASING_PLOT_RIGHT);
  assert.equal(easingPreviewX(domain, easingPreviewValue(domain, 1)), EASING_PLOT_LEFT);
  assert.equal(
    easingPreviewX(domain, easingPreviewValue(domain, 0.5)),
    (EASING_PLOT_LEFT + EASING_PLOT_RIGHT) / 2,
  );
});

test("the preview value follows the easing output instead of raw time", () => {
  const domain = easingPreviewValueDomain(0, -3);
  const eased = easing(0.5, 2);

  assert.equal(easingPreviewValue(domain, 0), 0);
  assert.equal(easingPreviewValue(domain, 1), -3);
  assert.equal(easingPreviewValue(domain, 0.75), -2.25);
  assert.ok(Math.abs(easingPreviewValue(domain, eased) + 3 * eased) < 1e-12);
});

test("the normalized preview keeps zero at the left when endpoints are omitted", () => {
  const domain = easingPreviewValueDomain();

  assert.equal(easingPreviewX(domain, easingPreviewValue(domain, 0)), EASING_PLOT_LEFT);
  assert.equal(easingPreviewX(domain, easingPreviewValue(domain, 1)), EASING_PLOT_RIGHT);
});
