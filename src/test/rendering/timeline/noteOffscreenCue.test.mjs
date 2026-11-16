/** Edge cues belong to the current-beat note and its own timeline edges. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  noteContainsBeat,
  offscreenCueSides,
  offscreenCueX,
} from "../../../frontend/screens/editor/workspace/timeline/notes/noteOffscreenCue.ts";

test("a current-beat note can produce a cue on either timeline edge", () => {
  assert.equal(noteContainsBeat(4, 4, 4), true);
  assert.deepEqual(offscreenCueSides(-12, 20, 0, 200), ["left"]);
  assert.deepEqual(offscreenCueSides(212, 20, 0, 200), ["right"]);
});

test("notes on another beat and fully visible notes produce no cue", () => {
  assert.equal(noteContainsBeat(4, 4, 4.5), false);
  assert.deepEqual(offscreenCueSides(100, 20, 0, 200), []);
});

test("a note body crossing both timeline edges reports both sides", () => {
  assert.deepEqual(offscreenCueSides(100, 240, 0, 200), ["left", "right"]);
});

test("edge cues stay pinned to the visible timeline edges", () => {
  assert.equal(offscreenCueX("left", -12, 188, 200, 8), 4);
  assert.equal(offscreenCueX("right", 12, 212, 200, 8), 188);
  assert.equal(offscreenCueX("left", -240, -40, 200, 8), null);
});
