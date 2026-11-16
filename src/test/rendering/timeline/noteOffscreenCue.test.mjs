/** Edge cues appear when a scaled note body is fully outside its timeline viewport. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  offscreenCueAlpha,
  offscreenCueDistance,
  offscreenCueSides,
} from "../../../frontend/screens/editor/workspace/timeline/notes/noteOffscreenCue.ts";

test("a scaled note body can produce a cue on either timeline edge", () => {
  assert.deepEqual(offscreenCueSides(-12, 20, 0, 200), ["left"]);
  assert.deepEqual(offscreenCueSides(212, 20, 0, 200), ["right"]);
  assert.equal(offscreenCueDistance(-12, 20, 0, 200, "left"), 2);
  assert.equal(offscreenCueDistance(212, 20, 0, 200, "right"), 2);
  assert.equal(offscreenCueAlpha(0, 200), 0);
  assert(offscreenCueAlpha(1, 200) > 0);
  assert(offscreenCueAlpha(1, 200) < 0.2);
  assert.equal(offscreenCueAlpha(16, 200), 0.2);
  assert.equal(offscreenCueAlpha(200, 200), 0.5);
});

test("a fully visible note produces no cue", () => {
  assert.deepEqual(offscreenCueSides(100, 20, 0, 200), []);
});

test("a partially visible note produces no cue", () => {
  assert.deepEqual(offscreenCueSides(5, 20, 0, 200), []);
  assert.deepEqual(offscreenCueSides(195, 20, 0, 200), []);
  assert.equal(offscreenCueDistance(5, 20, 0, 200, "left"), null);
  assert.equal(offscreenCueDistance(195, 20, 0, 200, "right"), null);
});

test("a note body spanning the viewport remains without a cue", () => {
  assert.deepEqual(offscreenCueSides(100, 240, 0, 200), []);
});
