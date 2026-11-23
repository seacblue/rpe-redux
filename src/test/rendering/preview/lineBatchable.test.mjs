/**
 * Which judge lines the shared GPU batch may paint.
 *
 * The shader path shows the batch and keeps the Canvas fallback transparent, so
 * a chart misclassified here loses every judge line at once. Lyric subtitles are
 * the case that used to do exactly that.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  lineBatchable,
  lineCanvasTransformNeeded,
} from "../../../frontend/screens/editor/workspace/preview/drawing/previewLines.ts";

const line = (overrides = {}) => ({ Texture: "line.png", ...overrides });

test("default-texture lines share the batch", () => {
  assert.equal(lineBatchable([line(), line(), line()]), true);
});

test("a line without a texture field shares the batch", () => {
  assert.equal(lineBatchable([{}, line()]), true);
});

test("a chart with no judge lines is batchable", () => {
  assert.equal(lineBatchable([]), true);
});

test("lyric subtitles do not push the chart off the batch", () => {
  const lined = line({
    extended: { textEvents: [{ start: "Act I", end: "Act I", startTime: [212, 0, 1] }] },
  });
  assert.equal(lineBatchable([line(), lined]), true);
});

test("an empty subtitle list still shares the batch", () => {
  assert.equal(lineBatchable([line({ extended: { textEvents: [] } })]), true);
});

test("a custom line texture keeps the Canvas path", () => {
  assert.equal(lineBatchable([line(), line({ Texture: "custom.png" })]), false);
});

test("one custom texture is enough to leave the batch", () => {
  const lines = [line(), line(), line({ Texture: "skins/line2.png" })];
  assert.equal(lineBatchable(lines), false);
});

test("batched lyric lines keep the Canvas transform for their text", () => {
  assert.equal(lineCanvasTransformNeeded("line", true, true, true), true);
  assert.equal(lineCanvasTransformNeeded("line", true, true, false), false);
  assert.equal(lineCanvasTransformNeeded("note", true, true, false), false);
});
