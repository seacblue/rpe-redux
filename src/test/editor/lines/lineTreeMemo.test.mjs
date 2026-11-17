/** Covers memo invalidation when a paged chart keeps one chart facade. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createLine } from "../../../core/global/chart/chart.ts";
import { lineTreePropsEqual } from "../../../frontend/screens/global/sections/lines/lineTreeMemo.ts";

test("line tree rerenders when the chart content revision changes", () => {
  const chart = createChart();
  chart.judgeLineList = [createLine("Before")];
  const base = {
    session: { lineIndex: 0 },
    chart,
    showGroups: true,
    selectedLineIds: new Set(["line-0"]),
    folderGroup: null,
    collapsedGroups: new Set(),
    treeLayout: "list",
  };

  chart.judgeLineList[0].Name = "After";

  assert.equal(
    lineTreePropsEqual({ ...base, contentRevision: 1 }, { ...base, contentRevision: 2 }),
    false,
  );
});
