/** Timeline note hit geometry keeps Hold interaction zones unambiguous. */
import assert from "node:assert/strict";
import test from "node:test";
import { holdPartAt } from "../../../core/edit/timeline/hitTest.ts";

test("a Hold's head, body, and tail zones select different drag operations", () => {
  const hold = { type: 2 };

  assert.equal(holdPartAt(hold, 100, 20, 88, 20, 12), "head");
  assert.equal(holdPartAt(hold, 100, 20, 55, 20, 12), "body");
  assert.equal(holdPartAt(hold, 100, 20, 28, 20, 12), "tail");
});
