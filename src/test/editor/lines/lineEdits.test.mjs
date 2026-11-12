/** Covers atomic parent-link edits used by the judge-line batch inspector. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createLine } from "../../../core/global/chart/chart.ts";
import { setLineParent, setLineParents } from "../../../core/global/chart/line/lineEdits.ts";

function chartWithLines() {
  const chart = createChart();
  chart.judgeLineList = [createLine("Root"), createLine("Child"), createLine("Other")];
  return chart;
}

test("sets one parent for every selected line in one chart edit", () => {
  const chart = chartWithLines();
  const next = setLineParents(chart, [1, 2], 0);

  assert.notEqual(next, chart);
  assert.deepEqual(
    next.judgeLineList?.map((line) => line.father),
    [-1, 0, 0],
  );
});

test("rejects a batch parent cycle before changing any line", () => {
  const chart = chartWithLines();
  chart.judgeLineList[1].father = 0;
  chart.judgeLineList[2].father = 1;

  assert.throws(
    () => setLineParents(chart, [0, 1], 1),
    /parent relationship would form a cycle|parent cycle|父线关系会形成循环/u,
  );
  assert.deepEqual(
    chart.judgeLineList.map((line) => line.father),
    [-1, 0, 1],
  );
});

test("the single-line helper keeps the existing structural contract", () => {
  const chart = chartWithLines();
  const next = setLineParent(chart, 1, 0);

  assert.equal(next.judgeLineList?.[1].father, 0);
  assert.equal(setLineParent(next, 1, 0), next);
});
