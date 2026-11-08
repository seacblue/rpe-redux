/** Verifies preview sizing and cache policies that keep free-camera and shader frames cheap. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CANVAS_PIXEL_RATIO,
  canvasPixelRatio,
  prepareCanvas,
} from "../../../frontend/screens/editor/canvas/canvas2d.ts";
import {
  backgroundCacheKey,
  PreviewBackground,
} from "../../../frontend/screens/editor/workspace/preview/render/background.ts";
import { shaderTextureSize } from "../../../frontend/screens/editor/workspace/preview/render/shaderPipeline.ts";
import { fragmentSource } from "../../../frontend/screens/editor/workspace/preview/render/shaderSource.ts";

/** Replaces the document factory for one test and always restores the global. */
function withDocument(factory, run) {
  const previous = globalThis.document;
  globalThis.document = { createElement: factory };
  try {
    return run();
  } finally {
    globalThis.document = previous;
  }
}

test("canvas pixel ratio is capped at two", () => {
  assert.equal(MAX_CANVAS_PIXEL_RATIO, 2);
  assert.equal(canvasPixelRatio(1), 1);
  assert.equal(canvasPixelRatio(1.5), 1.5);
  assert.equal(canvasPixelRatio(2), 2);
  assert.equal(canvasPixelRatio(3), 2);
  assert.equal(canvasPixelRatio(Number.NaN), 1);
});

test("prepareCanvas caps the backing store at the ratio limit", () => {
  const original = globalThis.devicePixelRatio;
  const context = {
    setTransform() {},
    clearRect() {},
  };
  const canvas = {
    width: 0,
    height: 0,
    clientWidth: 100,
    clientHeight: 50,
    getBoundingClientRect: () => ({ width: 100, height: 50 }),
    getContext: () => context,
  };
  try {
    globalThis.devicePixelRatio = 3;
    prepareCanvas(canvas);
    assert.equal(canvas.width, 200);
    assert.equal(canvas.height, 100);
    globalThis.devicePixelRatio = 1.5;
    prepareCanvas(canvas);
    assert.equal(canvas.width, 150);
    assert.equal(canvas.height, 75);
  } finally {
    globalThis.devicePixelRatio = original;
  }
});

test("background cache key ignores camera translation and zoom", () => {
  const image = { naturalWidth: 1920, naturalHeight: 1080 };
  const key = backgroundCacheKey(image, 1600, 900, 2, 10.5, 1);
  assert.equal(backgroundCacheKey(image, 1600, 900, 2, 10.5, 1), key);
  assert.notEqual(backgroundCacheKey(image, 1600, 900, 2, 12, 1), key);
  assert.notEqual(backgroundCacheKey(image, 1600, 900, 2, 10.5, 1.2), key);
  assert.notEqual(backgroundCacheKey(image, 1600, 900, 1, 10.5, 1), key);
  assert.notEqual(backgroundCacheKey(image, 800, 450, 2, 10.5, 1), key);
  assert.notEqual(
    backgroundCacheKey({ naturalWidth: 1280, naturalHeight: 720 }, 1600, 900, 2, 10.5, 1),
    key,
  );
});

test("background cache survives camera pans and zooms without repainting", () => {
  let cacheDraws = 0;
  const cacheContext = {
    filter: "none",
    setTransform() {},
    drawImage() {
      cacheDraws += 1;
    },
  };
  const cacheCanvas = {
    width: 0,
    height: 0,
    getContext: () => cacheContext,
  };
  const targetCalls = [];
  const target = {
    filter: "none",
    drawImage(...args) {
      targetCalls.push(args);
    },
  };
  withDocument(
    () => cacheCanvas,
    () => {
      const background = new PreviewBackground();
      const image = { naturalWidth: 1920, naturalHeight: 1080 };
      const clip = { left: 40, top: 20, width: 800, height: 600 };
      background.draw(target, image, 800, 600, 10.5, 1, 2, false, 40, 20, clip);
      assert.equal(cacheDraws, 1);
      background.draw(target, image, 900, 675, 10.5, 1, 2, false, -10, -20, clip);
      assert.equal(cacheDraws, 1);
      assert.equal(targetCalls.length, 2);
      background.draw(target, image, 900, 675, 14, 1, 2, false, -10, -20, clip);
      assert.equal(cacheDraws, 2);
    },
  );
});

test("shader texture fits the logical size inside 1920x1080", () => {
  assert.deepEqual(shaderTextureSize(1600, 900), { width: 1600, height: 900 });
  assert.deepEqual(shaderTextureSize(1920, 1080), { width: 1920, height: 1080 });
  assert.deepEqual(shaderTextureSize(3840, 2160), { width: 1920, height: 1080 });
  assert.deepEqual(shaderTextureSize(2560, 1440), { width: 1920, height: 1080 });
  assert.deepEqual(shaderTextureSize(1000, 2000), { width: 540, height: 1080 });
  assert.deepEqual(shaderTextureSize(0, 0), { width: 1, height: 1 });
});

test("legacy shader texture samples map the chart rectangle into the source texture", () => {
  const adapted = fragmentSource(
    `varying vec2 v_texCoord;\nuniform sampler2D u_texture;\nvoid main() { gl_FragColor = texture2D(CC_Texture0, v_texCoord); }`,
  );
  assert.match(
    adapted,
    /vec2 local = \(coordinate - vec2\(0\.0, 0\.0333\)\) \/ vec2\(0\.7031, 1\.0 \/ 1\.2\);/,
  );
  assert.match(adapted, /texture2D\(source, mix\(rpeRectMin, rpeRectMax, local\)\)/);
});

test("portable shader coordinates keep standard screen uniforms in the preview domain", () => {
  const adapted = fragmentSource(
    `varying vec2 uv;\nuniform sampler2D screenTexture;\nuniform vec2 screenSize;\nuniform float time;\nvoid main() { gl_FragColor = texture2D(screenTexture, uv + vec2(time / screenSize.x)); }`,
  );
  assert.doesNotMatch(adapted, /uniform sampler2D screenTexture/);
  assert.match(adapted, /uniform sampler2D u_texture/);
  assert.match(adapted, /rpeSample\(u_texture, rpeCoordinate/);
  assert.match(adapted, /screenSize/);
  assert.match(adapted, /u_time/);
});

test("built-in shaders use logical resolution for gl_FragCoord", () => {
  const adapted = fragmentSource(
    `// @rpen-builtin\nvarying vec2 v_texCoord;\nuniform vec2 resolution;\nvoid main() { gl_FragColor = vec4(gl_FragCoord.xy / resolution, 0.0, 1.0); }`,
  );
  assert.doesNotMatch(adapted, /rpenFragCoord/);
  assert.match(adapted, /resolution\)/);
});

test("custom sampler uniform names are mapped to the preview texture", () => {
  const adapted = fragmentSource(
    `varying vec2 v_texCoord;\nuniform sampler2D texture;\nvoid main() { gl_FragColor = texture2D(texture, v_texCoord); }`,
  );
  assert.doesNotMatch(adapted, /uniform sampler2D texture/);
  assert.match(adapted, /rpeSample\(u_texture, rpeCoordinate\)/);
});
