/** Verifies judge-line deletion, child re-parenting, and history behavior. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
} from "../../../core/global/chart/chart.ts";
import { createChartObjectId } from "../../../core/global/chart/identity.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { applyChartTransaction } from "../../../core/edit/transaction/preview.ts";

/** Build a line with one note and one event so deletion can be observed. */
function contentLine(name, father = -1) {
  const line = createLine(name);
  line.father = father;
  line.notes = [createNote(1, 0, 0)];
  line.eventLayers[0].moveXEvents = [createEvent(0, 1, 0, 1)];
  return line;
}

test("deleting a middle line cascades its objects and reparents its children", () => {
  const chart = createChart();
  const parent = contentLine("Parent");
  const child = contentLine("Child", 0);
  const grandchild = contentLine("Grandchild", 1);
  chart.judgeLineList = [parent, child, grandchild];
  const session = new EditorSession(chart);
  const childIds = [
    child.id,
    ...child.notes.map((note) => note.id),
    ...child.eventLayers[0].moveXEvents.map((event) => event.id),
  ];

  const result = applyChartTransaction(session, {
    label: "delete child",
    lines: { delete: [child.id] },
  });

  assert.equal(result.status, "committed");
  assert.deepEqual(
    session.chart.judgeLineList.map((line) => line.Name),
    ["Parent", "Grandchild"],
  );
  assert.equal(session.chart.judgeLineList[1].father, -1);
  for (const id of childIds) {
    assert.ok(result.affectedObjectIds.includes(id), `missing affected id ${id}`);
  }

  assert.equal(session.travel("undo"), true);
  assert.deepEqual(
    session.chart.judgeLineList.map((line) => line.Name),
    ["Parent", "Child", "Grandchild"],
  );
  assert.equal(session.chart.judgeLineList[2].father, 1);

  assert.equal(session.travel("redo"), true);
  assert.deepEqual(
    session.chart.judgeLineList.map((line) => line.Name),
    ["Parent", "Grandchild"],
  );
});

test("deleting a parent re-roots its child and shifts the grandchild relation", () => {
  const chart = createChart();
  const parent = contentLine("Parent");
  const child = contentLine("Child", 0);
  const grandchild = contentLine("Grandchild", 1);
  chart.judgeLineList = [parent, child, grandchild];
  const session = new EditorSession(chart);

  const result = applyChartTransaction(session, {
    label: "delete parent",
    lines: { delete: [parent.id] },
  });

  assert.equal(result.status, "committed");
  assert.deepEqual(
    session.chart.judgeLineList.map((line) => line.Name),
    ["Child", "Grandchild"],
  );
  assert.equal(session.chart.judgeLineList[0].father, -1);
  assert.equal(session.chart.judgeLineList[1].father, 0);
});

test("deleting several lines shifts the remaining relations once", () => {
  const chart = createChart();
  const lines = [
    contentLine("Line 0"),
    contentLine("Line 1", 0),
    contentLine("Line 2", 1),
    contentLine("Line 3", 2),
    contentLine("Line 4", 3),
  ];
  chart.judgeLineList = lines;
  const session = new EditorSession(chart);

  const result = applyChartTransaction(session, {
    label: "delete two lines",
    lines: { delete: [lines[0].id, lines[2].id] },
  });

  assert.equal(result.status, "committed");
  assert.deepEqual(
    session.chart.judgeLineList.map((line) => line.Name),
    ["Line 1", "Line 3", "Line 4"],
  );
  assert.equal(session.chart.judgeLineList[0].father, -1);
  assert.equal(session.chart.judgeLineList[1].father, -1);
  assert.equal(session.chart.judgeLineList[2].father, 1);
});

test("deleting the active line leaves the session on a valid line", () => {
  const chart = createChart();
  const lines = [contentLine("Line 0"), contentLine("Line 1"), contentLine("Line 2")];
  chart.judgeLineList = lines;
  const session = new EditorSession(chart);
  session.lineIndex = 2;

  const result = applyChartTransaction(session, {
    label: "delete active line",
    lines: { delete: [lines[2].id] },
  });

  assert.equal(result.status, "committed");
  assert.equal(session.chart.judgeLineList.length, 2);
  assert.ok(session.lineIndex >= 0 && session.lineIndex < 2);
});

test("a deletion that would remove the last line is rejected", () => {
  const chart = createChart();
  const session = new EditorSession(chart);
  const line = chart.judgeLineList[0];

  const result = applyChartTransaction(session, {
    label: "delete the only line",
    lines: { delete: [line.id] },
  });

  assert.equal(result.status, "rejected");
  assert.ok(result.issues.some((issue) => issue.code === "lines.delete.lastLine"));
  assert.equal(session.chart.judgeLineList.length, 1);
});

test("an unknown line id is rejected without changing the chart", () => {
  const chart = createChart();
  const session = new EditorSession(chart);
  const before = session.chart;

  const result = applyChartTransaction(session, {
    label: "delete unknown line",
    lines: { delete: [createChartObjectId()] },
  });

  assert.equal(result.status, "rejected");
  assert.ok(result.issues.some((issue) => issue.code === "line.id.notFound"));
  assert.equal(session.chart, before);
});
