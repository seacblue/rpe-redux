/** Verify the editor scheduler keeps continuous playback armed before painting. */
import assert from "node:assert/strict";
import test from "node:test";
import { EditorFrameScheduler } from "../../../frontend/screens/editor/workspace/runtime/frame/frameScheduler.ts";

test("continuous playback arms the next frame before the callback runs", () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const queued = [];
  let nextId = 0;
  let queuedDuringCallback = 0;
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++nextId;
    queued.push({ id, callback });
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    const index = queued.findIndex((entry) => entry.id === id);
    if (index >= 0) {
      queued.splice(index, 1);
    }
  };

  try {
    const scheduler = new EditorFrameScheduler(() => {
      queuedDuringCallback = queued.length;
      scheduler.dispose();
    });
    scheduler.schedule(true, false, true);
    const first = queued.shift();
    assert.ok(first);
    first.callback(0);
    assert.equal(queuedDuringCallback, 1);
    assert.equal(queued.length, 0);
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});
