/** Contract tests for the shader composite RenderDevice seam. */
import assert from "node:assert/strict";
import test from "node:test";
import { ShaderCompositeRenderDevice } from "../../../frontend/screens/editor/workspace/preview/render/shaderCompositeRenderDevice.ts";

test("shader composite device forwards one packet to the persistent pipeline", () => {
  const calls = [];
  const pipeline = {
    render: (...args) => {
      calls.push(args);
      return true;
    },
    dispose: () => {},
  };
  const device = new ShaderCompositeRenderDevice(pipeline);
  const packet = {
    sourceCanvas: {},
    targetCanvas: {},
    passes: [{ shader: "demo" }],
    seconds: 1.25,
    sourceFor: () => "shader",
    viewport: { left: 0, top: 0, width: 100, height: 100, scale: 1 },
    sourceRevision: 4,
    overlayCanvas: {},
  };

  assert.equal(device.render(packet), true);
  assert.deepEqual(calls, [
    [
      packet.sourceCanvas,
      packet.targetCanvas,
      packet.passes,
      packet.seconds,
      packet.sourceFor,
      packet.viewport,
      packet.sourceRevision,
      packet.overlayCanvas,
      undefined,
      undefined,
    ],
  ]);
});

test("shader composite device forwards an explicit shader target size", () => {
  const calls = [];
  const device = new ShaderCompositeRenderDevice({
    render: (...args) => {
      calls.push(args);
      return true;
    },
    dispose: () => {},
  });
  const textureLimit = { width: 1920, height: 1080 };

  device.render({
    sourceCanvas: {},
    targetCanvas: {},
    passes: [{ shader: "demo" }],
    seconds: 0,
    sourceFor: () => "shader",
    textureLimit,
  });

  assert.deepEqual(calls[0]?.at(-1), textureLimit);
});

test("shader composite device owns pipeline disposal", () => {
  let disposed = 0;
  const device = new ShaderCompositeRenderDevice({
    render: () => false,
    dispose: () => {
      disposed += 1;
    },
  });

  device.dispose();

  assert.equal(disposed, 1);
});

test("shader composite device forwards a shared GPU input layer", () => {
  const calls = [];
  const inputLayer = { finishToFramebuffer() {} };
  const pipeline = {
    render: (...args) => {
      calls.push(args);
      return true;
    },
    dispose: () => {},
  };
  const device = new ShaderCompositeRenderDevice(pipeline);

  device.render({
    sourceCanvas: {},
    targetCanvas: {},
    passes: [],
    seconds: 0,
    sourceFor: () => null,
    inputLayer,
  });

  assert.equal(calls[0]?.[8], inputLayer);
});
