/** Authored-field overflow stays clipped to the visible panel background. */
import assert from "node:assert/strict";
import test from "node:test";
import { offscreenRegionSegments } from "../../../frontend/screens/editor/workspace/timeline/multiLine/offscreenRegion.ts";

test("a shifted authored field produces left and right background regions", () => {
  assert.deepEqual(offscreenRegionSegments(0, 300, 20, 280, 300), [
    { x: 0, width: 20 },
    { x: 280, width: 20 },
  ]);
});

test("a partially visible panel clips its background region to the viewport", () => {
  assert.deepEqual(offscreenRegionSegments(-80, 220, 40, 180, 300), [
    { x: 0, width: 40 },
    { x: 180, width: 40 },
  ]);
});

test("an authored field that fills the panel produces no background segment", () => {
  assert.deepEqual(offscreenRegionSegments(0, 300, 0, 300, 300), []);
});
