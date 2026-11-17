/**
 * The proximity rule behind the floating timeline controls: a pointer counts
 * as near while it is inside the control box or inside the radial margin beside
 * it, so the controls fade in before the pointer reaches them.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  isPointNearRect,
  PROXIMITY_REVEAL_DISTANCE_PX,
} from "../../../frontend/screens/editor/workspace/timeline/interaction/proximityReveal.ts";

const RECT = { left: 100, top: 100, right: 200, bottom: 140 };

test("a pointer inside the control box is near", () => {
  assert.equal(isPointNearRect(RECT, 150, 120, 24), true);
});

test("the default margin is the shared approach distance", () => {
  const outer = PROXIMITY_REVEAL_DISTANCE_PX;
  assert.equal(isPointNearRect(RECT, RECT.right + outer, 120), true);
  assert.equal(isPointNearRect(RECT, RECT.right + outer + 1, 120), false);
});

test("a pointer exactly on the margin still counts as near", () => {
  assert.equal(isPointNearRect(RECT, 100, 100 - 24, 24), true);
  assert.equal(isPointNearRect(RECT, 200 + 24, 140, 24), true);
});

test("a pointer beyond the margin is away", () => {
  assert.equal(isPointNearRect(RECT, 100 - 25, 120, 24), false);
  assert.equal(isPointNearRect(RECT, 150, 140 + 25, 24), false);
});

test("the halo is radial at the corners", () => {
  // 20px out on both axes is about 28px from the corner, past a 24px margin.
  assert.equal(isPointNearRect(RECT, 80, 80, 24), false);
  assert.equal(isPointNearRect(RECT, 90, 90, 24), true);
});

test("a zero margin only accepts the control box", () => {
  assert.equal(isPointNearRect(RECT, 150, 120, 0), true);
  assert.equal(isPointNearRect(RECT, 100 - 1, 120, 0), false);
});
