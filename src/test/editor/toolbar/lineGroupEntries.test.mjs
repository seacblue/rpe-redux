/** Covers folder rows for the toolbar picker and the multi-line line list. */
import assert from "node:assert/strict";
import test from "node:test";
import { groupLineEntries } from "../../../frontend/screens/editor/lineSelection/lineGroupEntries.ts";

const line = (index, group) => ({ index, group });

test("declared empty folders stay in chart order", () => {
  assert.deepEqual(groupLineEntries([], ["First", "Second"]), [
    { index: 0, name: "First", entries: [] },
    { index: 1, name: "Second", entries: [] },
  ]);
});

test("lines fill their declared folder and keep the folder list order", () => {
  assert.deepEqual(
    groupLineEntries([line(0, "Second"), line(1, "First"), line(2, "Second")], ["First", "Second"]),
    [
      { index: 0, name: "First", entries: [line(1, "First")] },
      { index: 1, name: "Second", entries: [line(0, "Second"), line(2, "Second")] },
    ],
  );
});

test("an undeclared folder is appended instead of dropping its lines", () => {
  assert.deepEqual(groupLineEntries([line(0, "Orphan")], ["First"]), [
    { index: 0, name: "First", entries: [] },
    { index: 1, name: "Orphan", entries: [line(0, "Orphan")] },
  ]);
});
