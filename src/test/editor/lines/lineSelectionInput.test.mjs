/**
 * The judge-line field's grammar: ordered index/range/folder unions, optional
 * range steps, clamping, and the multi-line active-line annotation.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  formatLineSelection,
  formatLineSelectionDisplay,
  parseLineSelectionInput,
} from "../../../core/edit/state/lineSelectionInput.ts";
import { formatLineSelectionTokens } from "../../../core/edit/state/lineSelectionTokens.ts";

const LINES = Array.from({ length: 24 }, (_, index) => index);
const GROUPS = [
  { index: 0, name: "", label: "Default", indices: [0, 1] },
  { index: 1, name: "Drums", indices: [4, 5, 6] },
  { index: 2, name: "Lead A", indices: [10, 11] },
  { index: 3, name: "3", indices: [12] },
];

/** The selected lines, or null when the text is refused. */
function select(raw, available = LINES, groups = []) {
  return parseLineSelectionInput(raw, available, groups)?.lines ?? null;
}

/** The active line the parser would commit, or null when the text is refused. */
function active(raw, available = LINES, groups = []) {
  return parseLineSelectionInput(raw, available, groups)?.line ?? null;
}

test("an ASCII comma, a CJK comma, and a space all separate lines", () => {
  for (const raw of ["0,15", "0，15", "0 15"]) {
    assert.deepEqual(select(raw), [0, 15], raw);
    assert.equal(active(raw), 0, raw);
  }
});

test("separator styles can be mixed in one expression", () => {
  assert.deepEqual(select("0，15 20,22"), [0, 15, 20, 22]);
  assert.deepEqual(select("0-2, 5 7-8"), [0, 1, 2, 5, 7, 8]);
});

test("repeated separators are ignored", () => {
  assert.deepEqual(select("0   15"), [0, 15]);
  assert.deepEqual(select("0,,15"), [0, 15]);
  assert.deepEqual(select("0，， 15"), [0, 15]);
});

test("range expressions keep colon, CJK colon, and hyphen forms", () => {
  assert.deepEqual(select("0-3"), [0, 1, 2, 3]);
  assert.deepEqual(select("2:5"), [2, 3, 4, 5]);
  assert.deepEqual(select("2：5"), [2, 3, 4, 5]);
  assert.deepEqual(select("0 - 3"), [0, 1, 2, 3]);
  assert.deepEqual(select("0 : 3"), [0, 1, 2, 3]);
  assert.deepEqual(select("0 ： 3"), [0, 1, 2, 3]);
  assert.deepEqual(select("0：3,5"), [0, 1, 2, 3, 5]);
  assert.deepEqual(select("0：3 5"), [0, 1, 2, 3, 5]);
});

test("a reversed range reads in ascending order", () => {
  assert.deepEqual(select("5-2"), [2, 3, 4, 5]);
});

test("lines outside the document clamp to the nearest existing line", () => {
  assert.deepEqual(select("72"), [23]);
  assert.deepEqual(select("-3:100"), LINES);
  assert.deepEqual(select("0-4", [0, 2, 4]), [0, 2, 4]);
});

test("a trailing parenthesized line is the active-line annotation", () => {
  assert.deepEqual(select("0-15 (3)"), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(active("0-15 (3)"), 3);
  assert.deepEqual(select("0-15(20)"), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(active("0-15(20)"), 20);
  assert.equal(active("0-15（3）"), 3);
  assert.deepEqual(select("0，15 (20)"), [0, 15]);
  assert.equal(active("0，15 (20)"), 20);
});

test("the annotation does not have to belong to the union", () => {
  // The active line can sit outside the multi-line set after Ctrl+wheel moved it.
  assert.deepEqual(select("0-5 (20)"), [0, 1, 2, 3, 4, 5]);
  assert.equal(active("0-5 (20)"), 20);
});

test("a single parenthesized index names that one line", () => {
  assert.deepEqual(select("(0)"), [0]);
  assert.equal(active("(0)"), 0);
  assert.deepEqual(select("（3）"), [3]);
});

test("an RPE-style label keeps its line and ignores the annotation on a single line", () => {
  // RPE writes a parent line as `1(0)`; the selected line stays 1.
  assert.deepEqual(select("1(0)"), [1]);
  assert.equal(active("1(0)"), 1);
});

test("the annotation clamps to the document", () => {
  assert.equal(active("0-3 (99)"), 23);
});

test("invalid text is refused", () => {
  assert.equal(select(""), null);
  assert.equal(select("   "), null);
  assert.equal(select("abc"), null);
  assert.equal(select("0-"), null);
  assert.equal(select("0-15 (3) x"), null);
  assert.equal(select("(3"), null);
  assert.equal(select("0", []), null);
});

test("formatting keeps the input order and compacts only adjacent values", () => {
  assert.equal(formatLineSelection([0, 1, 2, 3, 15]), "0-3,15");
  assert.equal(formatLineSelection([5, 2, 1]), "5,2,1");
  assert.equal(formatLineSelection([2, 3, 1]), "2-3,1");
  assert.equal(formatLineSelection([]), "");
});

test("the display text carries the active line only for a union", () => {
  assert.equal(formatLineSelectionDisplay([0, 1, 2], 3), "0-2 (3)");
  assert.equal(formatLineSelectionDisplay([0, 1, 2, 3, 15], 3), "0-3,15 (3)");
  assert.equal(formatLineSelectionDisplay([7], 3), "7");
  assert.equal(formatLineSelectionDisplay([], 3), "");
});

test("display text parses back to the same union and active line", () => {
  for (const [lines, activeLine] of [
    [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 3],
    [[0, 15, 20, 22], 20],
    [[2, 3], 21],
    [[4], 4],
  ]) {
    const text = formatLineSelectionDisplay(lines, activeLine);
    assert.deepEqual(select(text), lines, text);
    assert.equal(active(text), activeLine, text);
  }
});

test("a step divides an inclusive range and defaults to one", () => {
  const lines = Array.from({ length: 121 }, (_, index) => index);
  assert.deepEqual(select("80:119/5", lines), [80, 85, 90, 95, 100, 105, 110, 115]);
  assert.deepEqual(select("80:120/5", lines), [80, 85, 90, 95, 100, 105, 110, 115, 120]);
  assert.deepEqual(select("80:83", lines), [80, 81, 82, 83]);
  assert.deepEqual(select("80：119/5", lines), [80, 85, 90, 95, 100, 105, 110, 115]);
  assert.deepEqual(select("80-119/5", lines), [80, 85, 90, 95, 100, 105, 110, 115]);
  assert.deepEqual(select("80 : 119 / 5", lines), [80, 85, 90, 95, 100, 105, 110, 115]);
});

test("a step range keeps the clamp and ascending rules", () => {
  assert.deepEqual(select("80:119/5"), [23]);
  assert.deepEqual(select("0:100/5"), [0, 5, 10, 15, 20]);
  const lines = Array.from({ length: 121 }, (_, index) => index);
  assert.deepEqual(select("119:80/5", lines), [80, 85, 90, 95, 100, 105, 110, 115]);
});

test("a non-positive, missing, or fractional step is refused", () => {
  assert.equal(select("0:10/0"), null);
  assert.equal(select("0:10/-2"), null);
  assert.equal(select("0:10/"), null);
  assert.equal(select("0:10/2.5"), null);
});

test("a step expression keeps the active-line annotation", () => {
  const lines = Array.from({ length: 121 }, (_, index) => index);
  assert.deepEqual(select("80:119/5 (85)", lines), [80, 85, 90, 95, 100, 105, 110, 115]);
  assert.equal(active("80:119/5 (85)", lines), 85);
});

test("a folder name adds every member in chart order", () => {
  assert.deepEqual(select("Drums", LINES, GROUPS), [4, 5, 6]);
  assert.deepEqual(select("Lead A", LINES, GROUPS), [10, 11]);
  assert.deepEqual(select("lead a", LINES, GROUPS), [10, 11]);
  assert.deepEqual(select("Default", LINES, GROUPS), [0, 1]);
});

test("a folder name can be mixed with numbers and other folders", () => {
  assert.deepEqual(select("Drums 2", LINES, GROUPS), [4, 5, 6, 2]);
  assert.deepEqual(select("Lead A, 2, Drums", LINES, GROUPS), [10, 11, 2, 4, 5, 6]);
  assert.deepEqual(select("2, Lead A, 5", LINES, GROUPS), [2, 10, 11, 5]);
});

test("a folder is matched before a number, and unknown names are refused", () => {
  assert.deepEqual(select("3", LINES, GROUPS), [12]);
  assert.equal(select("Missing", LINES, GROUPS), null);
});

test("the written order survives parsing, formatting, and reparsing", () => {
  assert.deepEqual(select("5, 3, 1"), [5, 3, 1]);
  assert.deepEqual(select("Drums, 2, 0-1", LINES, GROUPS), [4, 5, 6, 2, 0, 1]);
  const parsed = parseLineSelectionInput("5, 3, 1", LINES);
  assert.equal(formatLineSelectionTokens(parsed.tokens), "5,3,1");
  assert.deepEqual(select(formatLineSelectionTokens(parsed.tokens)), [5, 3, 1]);
});

test("the expression formatter writes a step and a folder as written", () => {
  const lines = Array.from({ length: 121 }, (_, index) => index);
  const parsed = parseLineSelectionInput("80:119/5, Drums", lines, GROUPS);
  assert.equal(formatLineSelectionTokens(parsed.tokens, GROUPS), "80:119/5,Drums");
  assert.deepEqual(
    select("80:119/5, Drums", lines, GROUPS),
    [80, 85, 90, 95, 100, 105, 110, 115, 4, 5, 6],
  );
});

test("an ambiguous folder name is expanded to its members", () => {
  const groups = [{ index: 1, name: "A,B", indices: [1, 2] }];
  assert.equal(select("A,B", LINES, groups), null);
  assert.equal(
    formatLineSelectionTokens([{ kind: "group", group: 1, name: "A,B" }], groups),
    "1-2",
  );
});

test("a numeric folder name is written and read as a folder", () => {
  assert.equal(formatLineSelectionTokens([{ kind: "group", group: 3, name: "3" }], GROUPS), "3");
  assert.deepEqual(select("3", LINES, GROUPS), [12]);
});

test("the display text keeps a reversed authored order", () => {
  assert.equal(formatLineSelectionDisplay([5, 3, 1], 3), "5,3,1 (3)");
  const text = formatLineSelectionDisplay([5, 3, 1], 3);
  assert.deepEqual(select(text), [5, 3, 1]);
});
