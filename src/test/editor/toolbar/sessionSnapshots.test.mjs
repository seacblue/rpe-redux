/** Covers toolbar line options when a paged chart keeps one chart facade. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createLine } from "../../../core/global/chart/chart.ts";
import { deleteLine } from "../../../core/global/chart/line/lineEdits.ts";
import { editorLineGroups, editorLineOptions } from "../../../core/edit/state/publishedValues.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { ChartDocument } from "../../../core/global/chart/streaming/chartDocument.ts";
import { publishEditorSessionSnapshots } from "../../../frontend/screens/editor/workspace/runtime/bridge/sessionSnapshots.ts";

function lineOptions() {
  return editorLineOptions.get().map(({ index, name, group }) => ({ index, name, group }));
}

test("toolbar line options follow paged chart commits", () => {
  const chart = createChart();
  chart.judgeLineGroup = ["First", "Second"];
  const first = createLine("Alpha");
  first.Group = 0;
  const second = createLine("Beta");
  second.Group = 1;
  chart.judgeLineList = [first, second];

  const session = EditorSession.fromDocument(ChartDocument.fromChart(chart));
  publishEditorSessionSnapshots(session, 2);
  assert.deepEqual(lineOptions(), [
    { index: 0, name: "Alpha", group: "First" },
    { index: 1, name: "Second.Beta", group: "Second" },
  ]);

  const renamed = [...session.chart.judgeLineList];
  renamed[0] = { ...renamed[0], Name: "Renamed" };
  session.commitChart("Rename line", { ...session.chart, judgeLineList: renamed });
  publishEditorSessionSnapshots(session, 2);
  assert.equal(lineOptions()[0].name, "Renamed");

  const added = [...session.chart.judgeLineList, { ...createLine("Gamma"), Group: 1 }];
  session.commitChart("Add line and group", {
    ...session.chart,
    judgeLineGroup: ["First", "Second", "Third"],
    judgeLineList: added,
  });
  publishEditorSessionSnapshots(session, 3);
  assert.deepEqual(lineOptions(), [
    { index: 0, name: "Renamed", group: "First" },
    { index: 1, name: "Second.Beta", group: "Second" },
    { index: 2, name: "Second.Gamma", group: "Second" },
  ]);
  // The empty folder has no line option, so the selector reads its own list.
  assert.deepEqual(editorLineGroups.get(), ["First", "Second", "Third"]);

  session.selectLine(1);
  session.commitLineChart("Delete line", deleteLine(session.chart, 0), 0);
  publishEditorSessionSnapshots(session, 2);
  assert.equal(session.lineIndex, 0);
  assert.deepEqual(lineOptions(), [
    { index: 0, name: "Second.Beta", group: "Second" },
    { index: 1, name: "Second.Gamma", group: "Second" },
  ]);
});
