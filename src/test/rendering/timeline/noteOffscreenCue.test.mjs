/** Edge cues only belong to a current-beat note and its crossed viewport side. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  noteContainsBeat,
  offscreenCueSides,
} from "../../../frontend/screens/editor/workspace/timeline/multiLine/noteOffscreenCue.ts";

test("a current-beat tap can produce a left or right cue", () => {
  assert.equal(noteContainsBeat(4, 4, 4), true);
  assert.deepEqual(offscreenCueSides(-12, 20, 200), ["left"]);
  assert.deepEqual(offscreenCueSides(212, 20, 200), ["right"]);
});

test("notes on another beat and fully visible notes produce no cue", () => {
  assert.equal(noteContainsBeat(4, 4, 4.5), false);
  assert.deepEqual(offscreenCueSides(100, 20, 200), []);
});

test("a body crossing both viewport edges reports both sides", () => {
  assert.deepEqual(offscreenCueSides(100, 240, 200), ["left", "right"]);
});
