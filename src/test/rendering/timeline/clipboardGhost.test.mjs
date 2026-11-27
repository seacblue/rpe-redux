/** Verifies clipboard ghosts target the judge line under the pointer and cover every visible track. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createLine, createNote } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { copyObjects } from "../../../core/edit/clipboard/operations.ts";
import { projectClipboardGhost } from "../../../frontend/screens/editor/workspace/timeline/clipboardGhost.ts";

/** A chart whose first two lines carry one selected note each. */
function chartWithCopiedNotes(multiLineIndices) {
  const chart = createChart();
  chart.judgeLineList = [createLine("L0"), createLine("L1"), createLine("L2"), createLine("L3")];
  chart.judgeLineList[0].notes = [createNote(1, 0, 0.5)];
  chart.judgeLineList[0].numOfNotes = 1;
  chart.judgeLineList[1].notes = [createNote(1, 0, -0.5)];
  chart.judgeLineList[1].numOfNotes = 1;
  const session = new EditorSession(chart);
  session.multiLineEnabled = true;
  session.multiLineMode = "notes";
  session.multiLineIndices = [...multiLineIndices];
  session.multiLineSelection = new Map([
    [0, new Set([0])],
    [1, new Set([0])],
  ]);
  assert.equal(copyObjects(session), 2);
  return session;
}

/** Project the clipboard ghost with the pointer over one judge line. */
function ghostOver(session, lineIndex) {
  return projectClipboardGhost({
    appearance: { clipboardGhostEnabled: true },
    gestures: {
      clipboardPointer: { x: 0, y: 20 },
      clipboardMode: {},
      cursorLineIndex: lineIndex,
    },
    viewport: { snappedBeatTriple: () => [0, 4, 1] },
    getSession: () => session,
  });
}

test("clipboard ghosts target the line under the pointer", () => {
  const chart = createChart();
  chart.judgeLineList.push(createLine("Line 2"));
  chart.judgeLineList[0].notes = [createNote(1, 0, 0.5)];
  const session = new EditorSession(chart);
  session.selection = new Set([0]);
  assert.equal(copyObjects(session), 1);

  const projection = ghostOver(session, 1);

  assert.equal(projection?.targetLineIndex, 1);
  assert.deepEqual(projection?.noteLines, [1]);
});

test("a multi-line ghost covers every track the paste targets", () => {
  const session = chartWithCopiedNotes([0, 1, 2, 3]);

  const projection = ghostOver(session, 2);

  assert.equal(projection?.targetLineIndex, 2);
  assert.deepEqual(
    projection?.noteLines,
    [2, 3],
    "both copied tracks preview on the panel each one lands on",
  );
});

test("a multi-line ghost drops the tracks the field cannot show", () => {
  const session = chartWithCopiedNotes([0, 1, 2]);

  const projection = ghostOver(session, 2);

  assert.deepEqual(
    projection?.noteLines,
    [2],
    "the preview matches the paste, which only writes visible tracks",
  );
});
