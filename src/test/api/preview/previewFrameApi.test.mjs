/** Public preview frame facade and request validation. */
import assert from "node:assert/strict";
import test from "node:test";
import { connectPreviewApi } from "../../../core/edit/preview/api.ts";
import { preview } from "../../../core/api/preview.ts";

function host(overrides = {}) {
  return {
    snapshot: () => null,
    subscribe: () => () => {},
    frame: async () => ({
      seconds: 2,
      beat: [2, 0, 1],
      beatValue: 2,
      width: 320,
      height: 180,
      format: "png",
      mimeType: "image/png",
      quality: 0.92,
      dataUrl: "data:image/png;base64,AAAA",
      byteLength: 3,
      chartFingerprint: "chart-1",
    }),
    ...overrides,
  };
}

test("preview.frame passes a normalized request to the host", async () => {
  let received;
  const dispose = connectPreviewApi(
    host({
      frame: async (request) => {
        received = request;
        return host().frame();
      },
    }),
  );
  try {
    const result = await preview.frame({ beat: 2, width: 320, height: 180 });
    assert.equal(result.ok, true);
    assert.deepEqual(received, {
      seconds: null,
      beat: [2, 0, 1],
      width: 320,
      height: 180,
      format: "png",
      quality: 0.92,
    });
    assert.equal(result.value.width, 320);
    assert.equal(Object.isFrozen(result.value), true);
    assert.equal(Object.isFrozen(result.value.beat), true);
  } finally {
    dispose();
  }
});

test("preview.frame rejects malformed input without calling the host", async () => {
  let calls = 0;
  const dispose = connectPreviewApi(
    host({
      frame: async () => {
        calls += 1;
        return host().frame();
      },
    }),
  );
  try {
    const result = await preview.frame({ seconds: 1, beat: 2 });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "invalid_request");
    assert.equal(calls, 0);
  } finally {
    dispose();
  }
});

test("preview.frame reports an unavailable preview runtime", async () => {
  const dispose = connectPreviewApi(host());
  dispose();
  const result = await preview.frame({ seconds: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unavailable");
});
