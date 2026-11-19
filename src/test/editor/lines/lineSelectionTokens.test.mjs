/**
 * The ordered line-selection token model: authored order, in-place subtraction,
 * block appends, folder membership, and formatter round-trips.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  addGroupSelection,
  addLineSelection,
  formatLineSelectionExpression,
  formatLineSelectionTokens,
  normalizeLineSelection,
  resolveLineSelection,
  sameLineOrder,
  subtractLineSelection,
  tokensForSelection,
  tokensFromLines,
} from "../../../core/edit/state/lineSelectionTokens.ts";

const LINES = Array.from({ length: 24 }, (_, index) => index);
const DRUMS = { index: 1, name: "Drums", indices: [4, 5, 6] };
const LEAD = { index: 2, name: "Lead A", indices: [10, 11] };
const GROUPS = [DRUMS, LEAD];

const line = (value) => ({ kind: "line", line: value });
const range = (start, end, step = 1) => ({ kind: "range", start, end, step });
const group = (index, name) => ({ kind: "group", group: index, name });

test("resolution keeps the written order and drops duplicate lines", () => {
  assert.deepEqual(resolveLineSelection([line(5), line(3), line(1)], LINES), [5, 3, 1]);
  assert.deepEqual(resolveLineSelection([line(5), line(3), line(5)], LINES), [5, 3]);
  assert.deepEqual(resolveLineSelection([range(4, 2)], LINES), [2, 3, 4]);
});

test("a step range resolves inclusively and filters unavailable lines", () => {
  const lines = Array.from({ length: 121 }, (_, index) => index);
  assert.deepEqual(
    resolveLineSelection([range(80, 119, 5)], lines),
    [80, 85, 90, 95, 100, 105, 110, 115],
  );
  assert.deepEqual(resolveLineSelection([range(0, 4)], [0, 2, 4]), [0, 2, 4]);
});

test("programmatic lines compact adjacent runs without reordering", () => {
  assert.deepEqual(tokensFromLines([5, 1, 2, 3]), [line(5), range(1, 3)]);
  assert.deepEqual(tokensFromLines([0, 1, 2, 5]), [range(0, 2), line(5)]);
  // Duplicates keep their first position; the repeated 1 cannot bridge 2 to 3.
  assert.deepEqual(tokensFromLines([5, 2, 1, 2, 3]), [line(5), line(2), line(1), line(3)]);
});

test("formatting writes one piece per authored token and never merges", () => {
  assert.equal(formatLineSelectionTokens([line(0), line(1), line(2)]), "0,1,2");
  assert.equal(formatLineSelectionTokens([line(5), line(3), line(1)]), "5,3,1");
  assert.equal(formatLineSelectionTokens([range(0, 3), line(15)]), "0-3,15");
  assert.equal(formatLineSelectionTokens([line(0), range(80, 119, 5)]), "0,80:119/5");
});

test("subtraction splits a range where it stands", () => {
  assert.deepEqual(subtractLineSelection([range(0, 9)], [4], LINES), [range(0, 3), range(5, 9)]);
  assert.deepEqual(subtractLineSelection([range(0, 9)], [0, 1], LINES), [range(2, 9)]);
  assert.deepEqual(subtractLineSelection([range(0, 9)], [8, 9], LINES), [range(0, 7)]);
  assert.deepEqual(subtractLineSelection([range(0, 9)], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], LINES), []);
});

test("subtracting one value from a step range keeps the step on both sides", () => {
  const many = Array.from({ length: 121 }, (_, index) => index);
  assert.deepEqual(subtractLineSelection([range(80, 119, 5)], [90], many), [
    range(80, 85, 5),
    range(95, 115, 5),
  ]);
  assert.deepEqual(subtractLineSelection([range(80, 119, 5)], [85], many), [
    line(80),
    range(90, 115, 5),
  ]);
});

test("a block append removes internal overlap, then lands at the end", () => {
  assert.deepEqual(addLineSelection([range(0, 3)], [2, 3, 4, 5], LINES), [
    range(0, 1),
    range(2, 5),
  ]);
  assert.deepEqual(addLineSelection([line(5), line(1), line(3)], [9], LINES), [
    line(5),
    line(1),
    line(3),
    line(9),
  ]);
});

test("adding a folder strips its members and appends the folder name", () => {
  assert.deepEqual(addGroupSelection([line(0), line(4), range(10, 12)], DRUMS, LINES, GROUPS), [
    line(0),
    range(10, 12),
    group(1, "Drums"),
  ]);
  assert.deepEqual(addGroupSelection([group(1, "Drums"), line(10)], DRUMS, LINES, GROUPS), [
    line(10),
    group(1, "Drums"),
  ]);
});

test("removing a folder strips its members in place", () => {
  assert.deepEqual(subtractLineSelection([group(1, "Drums"), line(10)], [4, 5, 6], LINES, GROUPS), [
    line(10),
  ]);
  assert.deepEqual(subtractLineSelection([group(1, "Drums"), line(10)], [4], LINES, GROUPS), [
    range(5, 6),
    line(10),
  ]);
});

test("a folder keeps its name when its membership is unchanged", () => {
  assert.deepEqual(normalizeLineSelection([group(1, "Drums")], LINES, GROUPS), {
    tokens: [group(1, "Drums")],
    lines: [4, 5, 6],
  });
});

test("an unnamed folder keeps the localized label the caller supplied", () => {
  const fallback = { index: 0, name: "", label: "Default", indices: [0, 1] };
  assert.deepEqual(normalizeLineSelection([group(0, "Default")], LINES, [fallback]), {
    tokens: [group(0, "Default")],
    lines: [0, 1],
  });
});

test("normalization drops missing lines and keeps the rest in order", () => {
  assert.deepEqual(normalizeLineSelection([line(5), line(2), range(3, 4)], [2, 3, 5]), {
    tokens: [line(5), line(2), line(3)],
    lines: [5, 2, 3],
  });
});

test("folder formatting writes a safe name and expands an unwritable one", () => {
  assert.equal(formatLineSelectionTokens([group(1, "Drums")], GROUPS), "Drums");
  assert.equal(formatLineSelectionTokens([group(2, "Lead A")], GROUPS), "Lead A");
  const ambiguous = { index: 3, name: "A,B", indices: [1, 2] };
  assert.equal(formatLineSelectionTokens([group(3, "A,B")], [ambiguous]), "1-2");
  const numeric = { index: 4, name: "3", indices: [12] };
  assert.equal(formatLineSelectionTokens([group(4, "3")], [numeric]), "3");
});

test("tokensForSelection trusts a matching expression and rebuilds a stale one", () => {
  assert.deepEqual(tokensForSelection([line(5), line(4), line(3)], [5, 4, 3], LINES), [
    line(5),
    line(4),
    line(3),
  ]);
  assert.deepEqual(tokensForSelection([range(0, 1)], [5, 3], LINES), [line(5), line(3)]);
});

test("the expression formatter appends the active line only for a union", () => {
  assert.equal(formatLineSelectionExpression([line(5), line(3)], [5, 3], 3), "5,3 (3)");
  assert.equal(formatLineSelectionExpression([line(5)], [5], 5), "5");
  assert.equal(formatLineSelectionExpression([], [], 0), "");
});

test("line order comparison is index-wise", () => {
  assert.equal(sameLineOrder([5, 3, 1], [5, 3, 1]), true);
  assert.equal(sameLineOrder([5, 3, 1], [1, 3, 5]), false);
  assert.equal(sameLineOrder([], []), true);
});
