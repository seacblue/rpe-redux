/** Verifies that every WebGL surface asks for the high-performance adapter. */
import assert from "node:assert/strict";
import test from "node:test";
import { WebGlRenderBackend } from "../../../frontend/screens/editor/canvas/renderBackend.ts";
import {
  acquireWebGl2,
  DEFAULT_WEBGL_CONTEXT_ATTRIBUTES,
} from "../../../frontend/screens/editor/canvas/webgl.ts";

/** Build a minimal canvas and WebGL context that records context attributes. */
function fakeCanvas() {
  const calls = [];
  const gl = {
    drawArraysInstanced() {},
    isContextLost() {
      return false;
    },
  };
  return {
    calls,
    canvas: {
      getContext(type, options) {
        calls.push({ type, options });
        return gl;
      },
      addEventListener() {},
      removeEventListener() {},
    },
  };
}

test("the shared WebGL defaults request the high-performance adapter", () => {
  assert.equal(DEFAULT_WEBGL_CONTEXT_ATTRIBUTES.powerPreference, "high-performance");

  const first = fakeCanvas();
  const backend = new WebGlRenderBackend(first.canvas);
  assert.equal(first.calls[0].options.powerPreference, "high-performance");
  backend.dispose();

  const second = fakeCanvas();
  acquireWebGl2(second.canvas);
  assert.equal(second.calls[0].options.powerPreference, "high-performance");
});

test("custom WebGL attributes keep the high-performance default", () => {
  const { canvas, calls } = fakeCanvas();
  const backend = new WebGlRenderBackend(canvas, { alpha: false });

  assert.equal(calls[0].options.alpha, false);
  assert.equal(calls[0].options.powerPreference, "high-performance");
  backend.dispose();
});
