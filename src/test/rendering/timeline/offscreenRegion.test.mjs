/** Authored-field overflow stays clipped to each visible note timeline. */
import assert from "node:assert/strict";
import test from "node:test";
import { offscreenRegionSegments } from "../../../frontend/screens/editor/workspace/timeline/notes/noteOffscreenRegion.ts";

test("the default camera fills the authored field without tinting", () => {
  assert.deepEqual(offscreenRegionSegments(0, 300, 0, 300), []);
});

test("a right camera shift tints the visible area beyond the authored range", () => {
  assert.deepEqual(offscreenRegionSegments(0, 300, 675, 300), [{ x: 150, width: 150 }]);
});

test("a left camera shift tints the visible area below the authored range", () => {
  assert.deepEqual(offscreenRegionSegments(0, 300, -675, 300), [{ x: 0, width: 150 }]);
});
