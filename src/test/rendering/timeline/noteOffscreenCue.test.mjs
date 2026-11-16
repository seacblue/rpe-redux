/** Edge cues appear when a scaled note body is fully outside its timeline viewport. */
import assert from "node:assert/strict";
import test from "node:test";
import { offscreenCueSides } from "../../../frontend/screens/editor/workspace/timeline/notes/noteOffscreenCue.ts";

test("a scaled note body can produce a cue on either timeline edge", () => {
  assert.deepEqual(offscreenCueSides(-12, 20, 0, 200), ["left"]);
  assert.deepEqual(offscreenCueSides(212, 20, 0, 200), ["right"]);
});

test("a fully visible note produces no cue", () => {
  assert.deepEqual(offscreenCueSides(100, 20, 0, 200), []);
});

test("a partially visible note produces no cue", () => {
  assert.deepEqual(offscreenCueSides(5, 20, 0, 200), []);
  assert.deepEqual(offscreenCueSides(195, 20, 0, 200), []);
});

test("a note body spanning the viewport remains without a cue", () => {
  assert.deepEqual(offscreenCueSides(100, 240, 0, 200), []);
});
