/** Differential contracts for the reusable timeline grid scratch buffers. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  visibleGridTicks,
  visibleGridTicksInto,
} from "../../../frontend/screens/editor/workspace/timeline/drawing/gridDrawing.ts";

test("reusable visible grid tick storage keeps the public sequence unchanged", () => {
  const target = [999];
  const expected = visibleGridTicks(0, 40, 5, 17);
  const result = visibleGridTicksInto(0, 40, 5, 17, target);

  assert.strictEqual(result, target);
  assert.deepEqual(result, expected);

  visibleGridTicksInto(3, 29, 4, null, target);
  assert.deepEqual(target, visibleGridTicks(3, 29, 4, null));
});
