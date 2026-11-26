/** Pure focus rules for the judge-line tree's pointer marquee. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveLineTreeMarqueeFocus,
  topmostLineInSelection,
} from "../../../frontend/screens/global/sections/lines/lineTreeSelection.ts";
import {
  createListSelectionState,
  listSelectionStateAfterClick,
} from "../../../design/patterns/list/listSelection.ts";

const ORDER = ["line:0", "line:1", "line:2", "line:3", "line:4", "line:5"];

test("Shift marquee focuses the line touched by the new gesture", () => {
  const focus = resolveLineTreeMarqueeFocus(ORDER, new Set(["line:0"]), ["line:4"], {
    shiftKey: true,
  });

  assert.equal(focus, "line:4");
});

test("a marquee does not focus an old selected line before the touched block", () => {
  const focus = resolveLineTreeMarqueeFocus(
    ORDER,
    new Set(["line:0", "line:5"]),
    ["line:2", "line:3"],
    { shiftKey: true },
  );

  assert.equal(focus, "line:2");
});

test("a Shift marquee records the topmost line touched by that gesture", () => {
  assert.equal(topmostLineInSelection(ORDER, ["line:4", "line:2", "line:3"]), "line:2");
});

test("a Shift click replaces the selection with X-Y and focuses Y", () => {
  const result = listSelectionStateAfterClick(
    ORDER,
    createListSelectionState(ORDER, ["line:2", "line:3", "line:4"], "line:2"),
    "line:5",
    { shiftKey: true },
    true,
  );

  assert.deepEqual(result, {
    selection: ["line:2", "line:3", "line:4", "line:5"],
    firstLine: "line:2",
    focus: "line:5",
  });
});
