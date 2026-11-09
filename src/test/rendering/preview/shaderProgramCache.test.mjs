/** Verify that shader programs are precompiled off the frame path and released when unused. */
import assert from "node:assert/strict";
import test from "node:test";
import { ShaderPipeline } from "../../../frontend/screens/editor/workspace/preview/render/shaderPipeline.ts";

/** Minimal WebGL surface for the program cache. */
function fakeGl({ linkSucceeds = true, parallel = false } = {}) {
  const created = [];
  const deleted = [];
  let completionPolls = 0;
  return {
    created,
    deleted,
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ACTIVE_UNIFORMS: 5,
    createShader: () => ({}),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    createProgram: () => {
      const program = {};
      created.push(program);
      return program;
    },
    attachShader() {},
    linkProgram() {},
    getProgramParameter: (_program, parameter) => {
      if (parameter === 6) {
        completionPolls += 1;
        return completionPolls > 1;
      }
      return parameter === 4 ? linkSucceeds : parameter === 5 ? 0 : false;
    },
    getProgramInfoLog: () => "",
    deleteShader() {},
    deleteProgram: (program) => deleted.push(program),
    getActiveUniform: () => null,
    getUniformLocation: () => null,
    getAttribLocation: () => -1,
    getExtension: (name) =>
      parallel && name === "KHR_parallel_shader_compile" ? { COMPLETION_STATUS_KHR: 6 } : null,
  };
}

function pipelineWithGl(options) {
  const gl = fakeGl(options);
  const pipeline = new ShaderPipeline();
  pipeline.gl = gl;
  pipeline.webgl2 = false;
  return { gl, pipeline };
}

test("precompile links each unique source once and reuses the cache", async () => {
  const { gl, pipeline } = pipelineWithGl();
  const entries = [
    { name: "a", source: "source-a" },
    { name: "b", source: "source-b" },
    { name: "a-clone", source: "source-a" },
  ];

  await pipeline.precompile(entries);

  assert.equal(gl.created.length, 2);
  assert.equal(pipeline.programs.size, 2);
  await pipeline.precompile(entries);
  assert.equal(gl.created.length, 2);
});

test("a pending precompile stops the frame path from linking synchronously", async () => {
  const { gl, pipeline } = pipelineWithGl();
  const task = pipeline.precompile([{ name: "a", source: "source-a" }]);

  assert.equal(pipeline.compile("a", "source-a"), null);
  assert.equal(gl.created.length, 0);

  await task;
  assert.equal(gl.created.length, 1);
  assert.ok(pipeline.programs.has("source-a"));
});

test("parallel shader compilation waits for the completion status", async () => {
  const { gl, pipeline } = pipelineWithGl({ parallel: true });

  await pipeline.precompile([{ name: "a", source: "source-a" }]);

  assert.equal(gl.created.length, 1);
  assert.ok(pipeline.programs.has("source-a"));
});

test("a failed source is not relinked on every frame", async () => {
  const { gl, pipeline } = pipelineWithGl({ linkSucceeds: false });
  await pipeline.precompile([{ name: "bad", source: "source-bad" }]);
  assert.equal(gl.created.length, 1);

  assert.equal(pipeline.compile("bad", "source-bad"), null);
  assert.equal(pipeline.compile("bad", "source-bad"), null);
  assert.equal(gl.created.length, 1);
});

test("retaining a source set releases every other WebGL program", async () => {
  const { gl, pipeline } = pipelineWithGl();
  await pipeline.precompile([
    { name: "a", source: "source-a" },
    { name: "b", source: "source-b" },
  ]);
  const released = pipeline.programs.get("source-b")?.program;

  pipeline.retainSources(["source-a"]);

  assert.deepEqual(gl.deleted, [released]);
  assert.deepEqual([...pipeline.programs.keys()], ["source-a"]);

  pipeline.retainSources([]);
  assert.equal(pipeline.programs.size, 0);
  assert.equal(gl.deleted.length, 2);
});
