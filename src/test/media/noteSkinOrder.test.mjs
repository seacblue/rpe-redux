/* Verify that discovered note skins keep their persisted insertion order. */
import assert from "node:assert/strict";
import test from "node:test";
import { orderNoteSkins } from "../../core/media/noteSkinOrder.ts";

test("note skins sort by added time and keep scan order for ties", () => {
  const entries = [
    { id: "newer", addedAt: 20 },
    { id: "legacy", addedAt: 0 },
    { id: "first", addedAt: 10 },
    { id: "same-time", addedAt: 10 },
  ];

  assert.deepEqual(
    orderNoteSkins(entries).map((entry) => entry.id),
    ["first", "same-time", "newer", "legacy"],
  );
});
