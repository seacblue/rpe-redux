/** Code Cell frame adapter validation, consent, and renderer forwarding. */
import assert from "node:assert/strict";
import test from "node:test";
import { createCodeCellAdapter } from "../../../core/edit/codecell/adapter.ts";

const revisions = Object.freeze({
  chartFingerprint: "chart-1",
  diskSnapshot: "disk-1",
  generation: 1,
});

const state = () => ({ revisions });

function frame(overrides = {}) {
  return {
    seconds: 4,
    beat: [4, 0, 1],
    beatValue: 4,
    width: 640,
    height: 360,
    format: "png",
    mimeType: "image/png",
    quality: 0.92,
    dataUrl: "data:image/png;base64,AAAA",
    byteLength: 3,
    chartFingerprint: "chart-1",
    ...overrides,
  };
}

test("cell.frame forwards a normalized time request to the capture host", async () => {
  let received;
  const adapter = createCodeCellAdapter({
    state,
    frame: async (request) => {
      received = request;
      return frame();
    },
  });
  const response = await adapter.handle({
    method: "cell.frame",
    params: { seconds: 4, width: 640, height: 360 },
  });
  assert.equal(response.ok, true);
  assert.equal(response.value.width, 640);
  assert.deepEqual(received, {
    seconds: 4,
    beat: null,
    width: 640,
    height: 360,
    format: "png",
    quality: 0.92,
  });
});

test("cell.frame forwards beat positions unchanged as a reduced triple", async () => {
  let received;
  const adapter = createCodeCellAdapter({
    state,
    frame: async (request) => {
      received = request;
      return frame();
    },
  });
  await adapter.handle({
    method: "cell.frame",
    params: { beat: [8, 2, 4] },
  });
  assert.equal(received.seconds, null);
  assert.deepEqual(received.beat, [8, 1, 2]);
});

test("cell.frame rejects malformed requests before rendering", async () => {
  let calls = 0;
  const adapter = createCodeCellAdapter({
    state,
    frame: async () => {
      calls += 1;
      return frame();
    },
  });
  const response = await adapter.handle({
    method: "cell.frame",
    params: { seconds: 1, beat: 2 },
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "invalid_request");
  assert.equal(calls, 0);
});

test("cell.frame respects the code-execution consent", async () => {
  const adapter = createCodeCellAdapter({
    state,
    enabled: () => false,
    frame: async () => frame(),
  });
  const response = await adapter.handle({
    method: "cell.frame",
    params: { seconds: 1 },
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "disabled");
});

test("cell.frame reports a renderer failure as a runtime error", async () => {
  const adapter = createCodeCellAdapter({
    state,
    frame: async () => {
      throw new Error("preview_frame_shader_failed");
    },
  });
  const response = await adapter.handle({
    method: "cell.frame",
    params: { seconds: 1 },
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "runtime");
  assert.match(response.error.message, /preview_frame_shader_failed/);
});
