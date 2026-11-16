/** Verifies guide atlas entries stay isolated for Canvas2D and WebGL sampling. */
import assert from "node:assert/strict";
import test from "node:test";
import { PreviewGuideTextAtlas } from "../../../frontend/screens/editor/workspace/preview/drawing/previewGuideAtlas.ts";

function label(text) {
  return {
    text,
    left: -text.length * 4,
    right: text.length * 4,
    top: -20,
    bottom: 30,
  };
}

test("guide atlas leaves a transparent sampling gap between glyphs", () => {
  const previousDocument = globalThis.document;
  const previousRatio = globalThis.devicePixelRatio;
  const draws = [];
  const atlasCanvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      save() {},
      restore() {},
      setTransform() {},
      fillText(text, x, y) {
        draws.push({ text, x, y });
      },
    }),
  };
  globalThis.devicePixelRatio = 1;
  globalThis.document = { createElement: () => atlasCanvas };
  try {
    const context = { font: "30px Saira" };
    const atlas = new PreviewGuideTextAtlas();
    const first = atlas.lookup(context, label("1"), "rgb(255,255,255)", 1).glyph;
    const second = atlas.lookup(context, label("12"), "rgb(255,255,255)", 1).glyph;
    assert.ok(first);
    assert.ok(second);
    assert.equal(first.sourceX, 2);
    assert.equal(first.sourceY, 2);
    assert.ok(second.sourceX >= first.sourceX + first.sourceWidth + 4);
    assert.ok(draws.every((draw) => Number.isFinite(draw.x) && Number.isFinite(draw.y)));
  } finally {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
    if (previousRatio === undefined) {
      delete globalThis.devicePixelRatio;
    } else {
      globalThis.devicePixelRatio = previousRatio;
    }
  }
});
