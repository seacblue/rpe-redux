/** Verify a full-screen shader quad clears a leftover instancing divisor before drawing. */
import assert from "node:assert/strict";
import test from "node:test";
import { ShaderPipeline } from "../../../frontend/screens/editor/workspace/preview/render/shaderPipeline.ts";

const DIVISOR = 0x88fe;

function recordingGl(divisors) {
  const draws = [];
  const divisorWrites = [];
  const divisorQueries = [];
  const gl = {
    FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    ARRAY_BUFFER: 0x8892,
    TRIANGLE_STRIP: 0x0005,
    FLOAT: 0x1406,
    VERTEX_ATTRIB_ARRAY_DIVISOR: DIVISOR,
    bindFramebuffer() {},
    framebufferTexture2D() {},
    viewport() {},
    disable() {},
    useProgram() {},
    bindBuffer() {},
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    activeTexture() {},
    bindTexture() {},
    uniform1i() {},
    drawArrays: () => draws.push("draw"),
    bindTextureNoop() {},
    getVertexAttrib: (location, parameter) => {
      divisorQueries.push([location, parameter]);
      return parameter === DIVISOR ? (divisors.has(location) ? 1 : 0) : 0;
    },
    vertexAttribDivisor: (location, value) => {
      divisorWrites.push([location, value]);
      if (value === 0) {
        divisors.delete(location);
      }
    },
  };
  gl.context = () => gl;
  return { gl, draws, divisorWrites, divisorQueries };
}

test("drawQuad clears a leftover divisor before drawing the full-screen quad", () => {
  const divisors = new Set([0, 1]);
  const { gl, draws, divisorWrites } = recordingGl(divisors);
  const pipeline = new ShaderPipeline();
  pipeline.gl = gl;

  pipeline.drawQuad(
    {
      program: {},
      defaults: new Map(),
      types: new Map(),
      uniforms: new Map(),
      positionAttribute: 0,
      texCoordAttribute: 1,
    },
    null,
    null,
    {},
    0,
    64,
    64,
    { min: [0, 0], max: [1, 1] },
    [64, 64],
  );

  assert.equal(draws.length, 1);
  assert.deepEqual(
    divisorWrites.map(([location, value]) => [location, value]),
    [
      [0, 0],
      [1, 0],
    ],
  );
});

test("drawQuad resets both attribute divisors without querying GL state", () => {
  const { gl, divisorWrites, divisorQueries } = recordingGl(new Set([1]));
  const pipeline = new ShaderPipeline();
  pipeline.gl = gl;

  pipeline.drawQuad(
    {
      program: {},
      defaults: new Map(),
      types: new Map(),
      uniforms: new Map(),
      positionAttribute: 0,
      texCoordAttribute: 1,
    },
    null,
    null,
    {},
    0,
    64,
    64,
    { min: [0, 0], max: [1, 1] },
    [64, 64],
  );

  assert.deepEqual(divisorWrites, [
    [0, 0],
    [1, 0],
  ]);
  assert.deepEqual(divisorQueries, []);
});

test("a WebGL1 context without vertexAttribDivisor still draws", () => {
  const { gl, draws } = recordingGl(new Set([0, 1]));
  delete gl.vertexAttribDivisor;
  delete gl.getVertexAttrib;
  delete gl.VERTEX_ATTRIB_ARRAY_DIVISOR;
  const pipeline = new ShaderPipeline();
  pipeline.gl = gl;

  pipeline.drawQuad(
    {
      program: {},
      defaults: new Map(),
      types: new Map(),
      uniforms: new Map(),
      positionAttribute: 0,
      texCoordAttribute: 1,
    },
    null,
    null,
    {},
    0,
    64,
    64,
    { min: [0, 0], max: [1, 1] },
    [64, 64],
  );

  assert.equal(draws.length, 1);
});
