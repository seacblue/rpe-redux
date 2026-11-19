/**
 * Session-level behavior for the ordered line list: authored order, step
 * ranges, folder tokens, add/remove splicing, snapshots, and persistence.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createLine,
  parseChart,
  serializeChart,
} from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { restoreSelection, selectionState } from "../../../core/edit/session/selectionHistory.ts";

/** A chart with enough lines for range tests. */
function chartWithLines(count = 24) {
  const chart = createChart();
  chart.judgeLineList = Array.from({ length: count }, (_, index) => createLine(`L${index}`));
  return chart;
}

test("a session keeps the written order and persists it numerically", () => {
  const session = new EditorSession(chartWithLines());

  session.setMultiLineSelection([5, 3, 1]);

  assert.deepEqual(session.multiLineIndices, [5, 3, 1]);
  assert.deepEqual(session.multiLineTokens, [
    { kind: "line", line: 5 },
    { kind: "line", line: 3 },
    { kind: "line", line: 1 },
  ]);
  assert.equal(session.chart.multiLineString, "5,3,1");
});

test("a step token survives the session and persists as its explicit lines", () => {
  const session = new EditorSession(chartWithLines(121));
  const tokens = [{ kind: "range", start: 80, end: 119, step: 5 }];
  const lines = [80, 85, 90, 95, 100, 105, 110, 115];

  session.setMultiLineSelection(lines, { tokens });

  assert.deepEqual(session.multiLineIndices, lines);
  assert.deepEqual(session.multiLineTokens, tokens);
  assert.equal(session.chart.multiLineString, "80,85,90,95,100,105,110,115");
});

test("a folder token stays authored and persists as its members", () => {
  const chart = chartWithLines(12);
  chart.judgeLineGroup = ["Default", "Drums"];
  for (let index = 0; index < 3; index += 1) {
    chart.judgeLineList[index].Group = 0;
  }
  for (let index = 3; index < 6; index += 1) {
    chart.judgeLineList[index].Group = 1;
  }
  const session = new EditorSession(chart);
  const tokens = [{ kind: "group", group: 1, name: "Drums" }];

  session.setMultiLineSelection([3, 4, 5], { tokens });

  assert.deepEqual(session.multiLineTokens, tokens);
  assert.deepEqual(session.multiLineIndices, [3, 4, 5]);
  assert.equal(session.chart.multiLineString, "3:5");

  const reopened = new EditorSession(parseChart(serializeChart(session.chart)));
  assert.deepEqual(reopened.multiLineRestore, [3, 4, 5]);
});

test("adding a line appends it and removing one splices its token", () => {
  const session = new EditorSession(chartWithLines());
  session.setMultiLineSelection([0, 5], {
    persist: false,
    tokens: [
      { kind: "line", line: 0 },
      { kind: "line", line: 5 },
    ],
  });

  session.addMultiLine(3);
  assert.deepEqual(session.multiLineIndices, [0, 5, 3]);
  assert.deepEqual(session.multiLineTokens, [
    { kind: "line", line: 0 },
    { kind: "line", line: 5 },
    { kind: "line", line: 3 },
  ]);

  session.setMultiLineSelection([0, 1, 2, 3, 4], {
    persist: false,
    tokens: [{ kind: "range", start: 0, end: 4, step: 1 }],
  });
  session.removeMultiLine(2);
  assert.deepEqual(session.multiLineIndices, [0, 1, 3, 4]);
  assert.deepEqual(session.multiLineTokens, [
    { kind: "range", start: 0, end: 1, step: 1 },
    { kind: "range", start: 3, end: 4, step: 1 },
  ]);
});

test("selection snapshots carry the authored tokens through restore", () => {
  const session = new EditorSession(chartWithLines());
  session.setMultiLineSelection([0, 1, 2], {
    persist: false,
    tokens: [{ kind: "range", start: 0, end: 2, step: 1 }],
  });
  const snapshot = selectionState(session);

  session.setMultiLineSelection([5], { persist: false });
  restoreSelection(session, snapshot);

  assert.deepEqual(session.multiLineIndices, [0, 1, 2]);
  assert.deepEqual(session.multiLineTokens, [{ kind: "range", start: 0, end: 2, step: 1 }]);
});
