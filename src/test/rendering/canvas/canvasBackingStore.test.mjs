/**
 * Canvas backing-store sizing: device-pixel scaling, the shared ratio cap, and
 * the zero-size floor used by 2D, cached-layer, and GPU paths.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CANVAS_PIXEL_RATIO,
  MAX_FALLBACK_CANVAS_PIXEL_RATIO,
  canvasBackingStoreSize,
  canvasPixelRatio,
  fallbackCanvasPixelRatio,
  prepareCanvas,
  sizeCanvasBackingStore,
} from "../../../frontend/screens/editor/canvas/canvas2d.ts";

/** Runs one test with a fixed device pixel ratio and always restores it. */
function withPixelRatio(ratio, run) {
  const original = globalThis.devicePixelRatio;
  try {
    globalThis.devicePixelRatio = ratio;
    return run();
  } finally {
    globalThis.devicePixelRatio = original;
  }
}

/** Minimal canvas stub for sizing tests. */
function fakeCanvas() {
  return {
    width: 0,
    height: 0,
    clientWidth: 100,
    clientHeight: 50,
    getBoundingClientRect: () => ({ width: 100, height: 50 }),
  };
}

test("sizeCanvasBackingStore follows the device pixel ratio", () => {
  withPixelRatio(1.5, () => {
    const canvas = fakeCanvas();
    const size = sizeCanvasBackingStore(canvas, { width: 100, height: 50 });
    assert.deepEqual(size, { width: 150, height: 75, ratio: 1.5 });
    assert.equal(canvas.width, 150);
    assert.equal(canvas.height, 75);
  });
});

test("sizeCanvasBackingStore clamps the ratio at the shared limit", () => {
  withPixelRatio(3, () => {
    const canvas = fakeCanvas();
    const size = sizeCanvasBackingStore(canvas, { width: 100, height: 50 });
    assert.equal(MAX_CANVAS_PIXEL_RATIO, 2);
    assert.equal(size.ratio, 2);
    assert.equal(canvas.width, 200);
    assert.equal(canvas.height, 100);
  });
});

test("fallback canvas ratio avoids a 2x software surface", () => {
  withPixelRatio(2, () => {
    assert.equal(MAX_FALLBACK_CANVAS_PIXEL_RATIO, 1.25);
    assert.equal(fallbackCanvasPixelRatio(), 1.25);
    assert.equal(fallbackCanvasPixelRatio(1), 1);
    assert.equal(fallbackCanvasPixelRatio(3), 1.25);
  });
});

test("sizeCanvasBackingStore keeps at least one physical pixel when the size is zero", () => {
  withPixelRatio(2, () => {
    const canvas = fakeCanvas();
    const size = sizeCanvasBackingStore(canvas, { width: 0, height: 0 });
    assert.deepEqual(size, { width: 1, height: 1, ratio: 2 });
    assert.equal(canvas.width, 1);
    assert.equal(canvas.height, 1);
  });
});

test("backing-store sizing is pure for the same measurement", () => {
  withPixelRatio(1.5, () => {
    assert.deepEqual(canvasBackingStoreSize({ width: 100, height: 50 }), {
      width: 150,
      height: 75,
      ratio: 1.5,
    });
    assert.deepEqual(canvasBackingStoreSize({ width: 100, height: 50 }, 3), {
      width: 200,
      height: 100,
      ratio: 2,
    });
  });
});

test("prepareCanvas caps the ratio and floors a zero-sized backing store", () => {
  const context = {
    setTransform() {},
    clearRect() {},
  };
  const canvas = {
    ...fakeCanvas(),
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
    getContext: () => context,
  };
  withPixelRatio(3, () => {
    prepareCanvas(canvas);
    assert.equal(canvas.width, 1);
    assert.equal(canvas.height, 1);
    assert.equal(canvasPixelRatio(), 2);
  });
});
