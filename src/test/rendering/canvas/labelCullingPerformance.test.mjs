/** Regression contracts for timeline label-culling storage reuse. */
import assert from "node:assert/strict";
import test from "node:test";
import { TimelineLabelCuller } from "../../../frontend/screens/editor/workspace/timeline/drawing/labelCulling.ts";

test("label culling clears placements without retaining previous-frame hits", () => {
  const culler = new TimelineLabelCuller();
  assert.equal(culler.tryPlace({ x: 10, y: 10 }), true);
  assert.equal(culler.tryPlace({ x: 12, y: 12 }), false);
  culler.clear();
  assert.equal(culler.tryPlace({ x: 12, y: 12 }), true);
  assert.equal(culler.tryPlace({ x: 14, y: 14 }), false);
});
