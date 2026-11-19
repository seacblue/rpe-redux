/**
 * Folder names drop commas and parentheses before they reach the chart, so a
 * folder can always be written in the ordered line expression.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart } from "../../../core/global/chart/chart.ts";
import {
  addLineGroup,
  renameLineGroup,
  sanitizeLineGroupName,
} from "../../../core/global/chart/line/lineTreeEdits.ts";

test("folder sanity removes ASCII and CJK commas and parentheses", () => {
  assert.equal(sanitizeLineGroupName("Drums, (Lead)"), "Drums Lead");
  assert.equal(sanitizeLineGroupName("鼓组，（主奏）"), "鼓组主奏");
  assert.equal(sanitizeLineGroupName("  Main , A  "), "Main  A");
  assert.equal(sanitizeLineGroupName("()（）,，"), "");
});

test("ordinary folder names keep their spaces and punctuation", () => {
  assert.equal(sanitizeLineGroupName("Lead A"), "Lead A");
  assert.equal(sanitizeLineGroupName("Act-1 / B"), "Act-1 / B");
});

test("creating a folder applies the same sanity", () => {
  const chart = createChart();
  chart.judgeLineGroup = ["Default"];
  const next = addLineGroup(chart, "Lead, (A)");
  assert.deepEqual(next.judgeLineGroup, ["Default", "Lead A"]);
  assert.deepEqual(chart.judgeLineGroup, ["Default"]);
});

test("renaming a folder applies the same sanity", () => {
  const chart = createChart();
  chart.judgeLineGroup = ["Default", "Drums"];
  const next = renameLineGroup(chart, 1, "Main（鼓）, A");
  assert.deepEqual(next.judgeLineGroup, ["Default", "Main鼓 A"]);
  assert.deepEqual(chart.judgeLineGroup, ["Default", "Drums"]);
});
