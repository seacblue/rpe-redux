/** Covers line-panel commits that replace the active line after a deletion. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createLine } from "../../../core/global/chart/chart.ts";
import { deleteLine } from "../../../core/global/chart/line/lineEdits.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";

test("deleting the active line drops the deleted line from every session selection", () => {
  const chart = createChart();
  const first = createLine("First");
  const deleted = createLine("Deleted");
  deleted.notes = [{ id: "deleted-note" }];
  const retained = createLine("Retained");
  chart.judgeLineList = [first, deleted, retained];

  const session = new EditorSession(chart);
  session.selectLine(1);
  session.selection = new Set([0]);
  session.setMultiLineSelection([1, 2]);
  session.commitLineChart("Delete line", deleteLine(session.chart, 1), 1);

  assert.deepEqual(
    session.chart.judgeLineList?.map((line) => line.Name),
    ["First", "Retained"],
  );
  assert.deepEqual(session.multiLineIndices, [1]);
  assert.equal(session.multiLineActive, false);
  assert.deepEqual([...session.selection], []);
});

test("editing the active line keeps its selection when its id survives", () => {
  const chart = createChart();
  const active = createLine("Active");
  active.notes = [{ id: "active-note" }];
  chart.judgeLineList = [createLine("First"), active, createLine("Last")];
  const session = new EditorSession(chart);
  session.selectLine(1);
  session.selection = new Set([0]);
  session.setMultiLineSelection([1, 2]);

  const lines = [...session.chart.judgeLineList];
  lines[1] = { ...lines[1], Name: "Renamed" };
  session.commitLineChart("Rename line", { ...session.chart, judgeLineList: lines }, 1);

  assert.equal(session.chart.judgeLineList?.[1].Name, "Renamed");
  assert.deepEqual(session.multiLineIndices, [1, 2]);
  assert.deepEqual([...session.selection], [0]);
});

test("deleting a preceding line shifts the active line without dropping its selection", () => {
  const chart = createChart();
  const active = createLine("Active");
  active.notes = [{ id: "active-note" }];
  chart.judgeLineList = [createLine("Deleted"), createLine("Middle"), active];
  const session = new EditorSession(chart);
  session.selectLine(2);
  session.selection = new Set([0]);

  session.commitLineChart("Delete line", deleteLine(session.chart, 0), session.lineIndex);

  assert.equal(session.lineIndex, 1);
  assert.equal(session.line?.Name, "Active");
  assert.deepEqual([...session.selection], [0]);
});
