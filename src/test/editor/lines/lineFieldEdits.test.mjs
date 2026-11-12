/** Covers scalar, identity, and relational batch edits from the line form. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createLine } from "../../../core/global/chart/chart.ts";
import { editLineField } from "../../../frontend/screens/global/sections/lines/lineFieldEdits.ts";

function chartWithLines() {
  const chart = createChart();
  chart.judgeLineList = [createLine("A"), createLine("B"), createLine("C")];
  return chart;
}

test("batch edits name and parent fields across the selection", () => {
  const chart = chartWithLines();
  const renamed = editLineField(chart, [1, 2], { field: "name", value: "Shared" });
  const reparented = editLineField(renamed, [1, 2], { field: "parent", value: "0" });

  assert.deepEqual(
    reparented.judgeLineList?.map((line) => [line.Name, line.father]),
    [
      ["A", -1],
      ["Shared", 0],
      ["Shared", 0],
    ],
  );
});

test("batch edits rotation inheritance and leaves mixed numeric values blank", () => {
  const chart = chartWithLines();
  chart.judgeLineList[1].zOrder = 2;
  chart.judgeLineList[2].zOrder = 4;
  const unchanged = editLineField(chart, [1, 2], { field: "zOrder", value: "" });
  const changed = editLineField(unchanged, [1, 2], {
    field: "rotateWithFather",
    value: "",
    checked: true,
  });

  assert.equal(unchanged, chart);
  assert.deepEqual(
    changed.judgeLineList?.slice(1).map((line) => [line.zOrder, line.rotateWithFather]),
    [
      [2, true],
      [4, true],
    ],
  );
});

test("blank mixed parent input keeps each relation and -1 clears the batch", () => {
  const chart = chartWithLines();
  chart.judgeLineList[1].father = 0;
  chart.judgeLineList[2].father = -1;

  const unchanged = editLineField(chart, [1, 2], { field: "parent", value: "" });
  const cleared = editLineField(unchanged, [1, 2], { field: "parent", value: "-1" });

  assert.equal(unchanged, chart);
  assert.deepEqual(
    cleared.judgeLineList?.slice(1).map((line) => line.father),
    [-1, -1],
  );
});
