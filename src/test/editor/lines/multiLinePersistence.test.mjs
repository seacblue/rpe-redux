/** Verify that multi-line line lists round-trip through chart persistence. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createLine,
  parseChart,
  serializeChart,
} from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";

/** Build a chart with enough judge lines for range persistence tests. */
function chartWithLines() {
  const chart = createChart();
  chart.judgeLineList = [createLine("L0"), createLine("L1"), createLine("L2")];
  return chart;
}

test("multi-line selections persist as an RPE-compatible chart expression", () => {
  const chart = chartWithLines();
  const session = new EditorSession(chart);

  session.setMultiLineSelection([0, 1, 2]);

  assert.equal(session.chart.multiLineString, "0:2");
  assert.equal(session.history.dirty, true);
  const reopened = new EditorSession(parseChart(serializeChart(session.chart)));
  assert.deepEqual(reopened.multiLineRestore, [0, 1, 2]);
  assert.equal(reopened.lineIndex, 0);
});

test("collapsing multi-line editing keeps the persisted line list", () => {
  const chart = chartWithLines();
  const session = new EditorSession(chart);
  session.setMultiLineSelection([0, 1, 2]);

  session.setMultiLineSelection([0], { persist: false });

  assert.equal(session.chart.multiLineString, "0:2");
  assert.deepEqual(session.multiLineIndices, [0]);
});

test("legacy multi-line arrays seed the restore list", () => {
  const chart = chartWithLines();
  chart.multiLine = [1, 2];

  const session = new EditorSession(chart);

  assert.deepEqual(session.multiLineRestore, [1, 2]);
  assert.equal(session.lineIndex, 1);
});
