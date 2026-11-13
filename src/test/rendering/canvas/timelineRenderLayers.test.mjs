/** Contracts for reusable timeline render layers and their invalidation seam. */
import assert from "node:assert/strict";
import test from "node:test";
import { TimelineCache } from "../../../frontend/screens/editor/workspace/timeline/drawing/timelineCache.ts";

test("timeline render layers reuse surfaces by slot and repaint only on invalidation", () => {
  const previousDocument = globalThis.document;
  const contexts = [];
  globalThis.document = {
    createElement(type) {
      assert.equal(type, "canvas");
      const context = {
        setTransform() {},
        clearRect() {},
      };
      contexts.push(context);
      return {
        width: 0,
        height: 0,
        getContext() {
          return context;
        },
      };
    },
  };
  try {
    const cache = new TimelineCache();
    const owner = {};
    const first = cache.canvasLayer(owner, "stable", 320, 180, "lanes");
    const second = cache.canvasLayer(owner, "stable", 320, 180, "lanes");
    const otherSlot = cache.canvasLayer(owner, "stable", 320, 180, "labels");
    const changed = cache.canvasLayer(owner, "changed", 320, 180, "lanes");

    assert.equal(first.repaint, true);
    assert.equal(second.repaint, false);
    assert.strictEqual(second.canvas, first.canvas);
    assert.notStrictEqual(otherSlot.canvas, first.canvas);
    assert.equal(otherSlot.repaint, true);
    assert.strictEqual(changed.canvas, first.canvas);
    assert.equal(changed.repaint, true);
    assert.equal(contexts.length, 2);
  } finally {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
  }
});
