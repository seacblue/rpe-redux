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

/** The user-visible part of a click result; token shape is asserted separately. */
function clicked(result) {
  return { current: result.current, selection: result.selection };
}

test("a plain click replaces the selection and makes the line current", () => {
  assert.deepEqual(clicked(lineBarSelectionAfterClick(0, [0, 1], 3, false)), {
    current: 3,
    selection: [3],
  });
});

test("shift-click toggles one line like the toolbar", () => {
  assert.deepEqual(clicked(lineBarSelectionAfterClick(2, [1, 2, 3], 2, true)), {
    current: 1,
    selection: [1, 3],
  });
});

test("clicking a selected line removes it and keeps a remaining member current", () => {
  assert.deepEqual(clicked(lineBarSelectionAfterClick(2, [1, 2, 3], 2, true)), {
    current: 1,
    selection: [1, 3],
  });
  assert.deepEqual(clicked(lineBarSelectionAfterClick(2, [1, 2, 3], 1, true)), {
    current: 2,
    selection: [2, 3],
  });
});

test("the last selected line is protected", () => {
  assert.deepEqual(clicked(lineBarSelectionAfterClick(1, [1], 1, true)), {
    current: 1,
    selection: [1],
  });
});

test("shift-click appends a new line at the end", () => {
  assert.deepEqual(clicked(lineBarSelectionAfterClick(2, [0, 5], 4, true)), {
    current: 4,
    selection: [0, 5, 4],
  });
  assert.deepEqual(clicked(lineBarSelectionAfterClick(4, [1], 2, true)), {
    current: 2,
    selection: [1, 2],
  });
});

test("removing a line inside a range splits it in place", () => {
  const result = lineBarSelectionAfterClick(1, [0, 1, 2], 1, true, [
    { kind: "range", start: 0, end: 2, step: 1 },
  ]);
  assert.deepEqual(result.selection, [0, 2]);
  assert.deepEqual(result.tokens, [
    { kind: "line", line: 0 },
    { kind: "line", line: 2 },
  ]);
});

test("adding a line keeps a step range and appends the new line", () => {
  const result = lineBarSelectionAfterClick(
    85,
    [80, 85],
    90,
    true,
    [{ kind: "range", start: 80, end: 85, step: 5 }],
    [80, 85, 90],
  );
  assert.deepEqual(result.selection, [80, 85, 90]);
  assert.deepEqual(result.tokens, [
    { kind: "range", start: 80, end: 85, step: 5 },
    { kind: "line", line: 90 },
  ]);
});

test("the scroll helper leaves a visible row alone and reveals an off-screen one", () => {
  assert.equal(lineBarScrollLeft(40, 100, 50, 80), 40);
  assert.equal(lineBarScrollLeft(100, 100, 60, 80, 4), 56);
  assert.equal(lineBarScrollLeft(0, 100, 90, 120, 4), 24);
  assert.equal(lineBarScrollLeft(30, 100, 10, 180, 4), 6);
});
