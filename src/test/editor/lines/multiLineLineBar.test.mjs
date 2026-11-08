/** Pure rules shared by the multi-line judge-line bar and inspector list. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMultiLineLineBarItems,
  lineBarScrollLeft,
  lineBarSelectionAfterClick,
} from "../../../frontend/screens/editor/multiLine/multiLineLineBar.ts";

const fallback = (index) => `第 ${index} 条`;

test("line-bar rows strip the group prefix and mark current and selected lines", () => {
  const items = buildMultiLineLineBarItems(
    [
      { index: 0, label: "Line 0.Untitled", name: "Untitled", group: "" },
      { index: 1, label: "Line 1.Group A.Saw", name: "Group A.Saw", group: "Group A" },
      { index: 2, label: "Line 2.", name: "", group: "" },
    ],
    [1],
    1,
    fallback,
  );

  assert.deepEqual(items, [
    {
      index: 0,
      name: "Untitled",
      group: "",
      current: false,
      selected: false,
    },
    {
      index: 1,
      name: "Saw",
      group: "Group A",
      current: true,
      selected: true,
    },
    {
      index: 2,
      name: "第 2 条",
      group: "",
      current: false,
      selected: false,
    },
  ]);
});

test("a plain click replaces the selection and makes the line current", () => {
  assert.deepEqual(lineBarSelectionAfterClick(0, [0, 1], 3, false), {
    current: 3,
    selection: [3],
  });
});

test("shift-click toggles one line like the toolbar", () => {
  assert.deepEqual(lineBarSelectionAfterClick(2, [1, 2, 3], 2, true), {
    current: 1,
    selection: [1, 3],
  });
});

test("clicking a selected line removes it and keeps a remaining member current", () => {
  assert.deepEqual(lineBarSelectionAfterClick(2, [1, 2, 3], 2, true), {
    current: 1,
    selection: [1, 3],
  });
  assert.deepEqual(lineBarSelectionAfterClick(2, [1, 2, 3], 1, true), {
    current: 2,
    selection: [2, 3],
  });
});

test("the last selected line is protected", () => {
  assert.deepEqual(lineBarSelectionAfterClick(1, [1], 1, true), {
    current: 1,
    selection: [1],
  });
});

test("shift-click adds or removes only the clicked line", () => {
  assert.deepEqual(lineBarSelectionAfterClick(2, [0, 5], 4, true), {
    current: 4,
    selection: [0, 4, 5],
  });
  assert.deepEqual(lineBarSelectionAfterClick(4, [1], 2, true), {
    current: 2,
    selection: [1, 2],
  });
});

test("the scroll helper leaves a visible row alone and reveals an off-screen one", () => {
  assert.equal(lineBarScrollLeft(40, 100, 50, 80), 40);
  assert.equal(lineBarScrollLeft(100, 100, 60, 80, 4), 56);
  assert.equal(lineBarScrollLeft(0, 100, 90, 120, 4), 24);
  assert.equal(lineBarScrollLeft(30, 100, 10, 180, 4), 6);
});
