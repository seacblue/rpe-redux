/** Checks preview frame reuse against retained animation state. */
import assert from "node:assert/strict";
import test from "node:test";
import { canReusePreviewFrame } from "../../../frontend/screens/editor/workspace/preview/scene/previewFrameRequest.ts";

test("an active hit effect prevents reuse of an otherwise identical preview frame", () => {
  const chart = {};
  const tempo = {};
  const selection = new Map();
  const args = [chart, tempo, 2, 0, selection];
  const previous = { chart, tempo, seconds: 2, selectedLine: 0, selectedNotes: selection };

  assert.equal(canReusePreviewFrame(null, ...args, false), false);
  assert.equal(canReusePreviewFrame(previous, ...args, false), true);
  assert.equal(canReusePreviewFrame(previous, ...args, true), false);
});
