/** Folder names are sanitized into writable, collision-free expression tokens. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, normalizeChartObjectIds } from "../../../core/global/chart/chart.ts";
import { normalizeLineGroupNames } from "../../../core/global/chart/line/lineGroups.ts";
import {
  addLineGroup,
  isReservedLineGroupName,
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

test("all is reserved for the multi-line selection keyword", () => {
  assert.equal(isReservedLineGroupName("all"), true);
  assert.equal(isReservedLineGroupName(" ALL "), true);
  assert.equal(isReservedLineGroupName("All Notes"), false);
  assert.equal(sanitizeLineGroupName("all"), "all1");
  assert.equal(sanitizeLineGroupName("all", ["all1"]), "all2");
  assert.equal(sanitizeLineGroupName("all", ["all1", "all2"]), "all3");
});

test("legacy reserved folders take the first available numeric suffix", () => {
  const chart = createChart();
  chart.judgeLineGroup = ["Default", "all", "all1", "all"];
  normalizeLineGroupNames(chart);
  assert.deepEqual(chart.judgeLineGroup, ["Default", "all2", "all1", "all3"]);
});

test("chart normalization repairs reserved folders before editor use", () => {
  const chart = { ...createChart(), judgeLineGroup: ["Default", "all"] };
  normalizeChartObjectIds(chart);
  assert.deepEqual(chart.judgeLineGroup, ["Default", "all1"]);
});

test("creating a folder applies the same sanity", () => {
  const chart = createChart();
  chart.judgeLineGroup = ["Default"];
  const next = addLineGroup(chart, "Lead, (A)");
  assert.deepEqual(next.judgeLineGroup, ["Default", "Lead A"]);
  assert.deepEqual(chart.judgeLineGroup, ["Default"]);
});

test("creating and renaming folders suffix reserved names around occupied slots", () => {
  const chart = createChart();
  chart.judgeLineGroup = ["Default", "all1"];
  const added = addLineGroup(chart, "all");
  assert.deepEqual(added.judgeLineGroup, ["Default", "all1", "all2"]);
  const renamed = renameLineGroup(added, 1, "all");
  assert.deepEqual(renamed.judgeLineGroup, ["Default", "all1", "all2"]);
});

test("renaming a folder applies the same sanity", () => {
  const chart = createChart();
  chart.judgeLineGroup = ["Default", "Drums"];
  const next = renameLineGroup(chart, 1, "Main（鼓）, A");
  assert.deepEqual(next.judgeLineGroup, ["Default", "Main鼓 A"]);
  assert.deepEqual(chart.judgeLineGroup, ["Default", "Drums"]);
});
