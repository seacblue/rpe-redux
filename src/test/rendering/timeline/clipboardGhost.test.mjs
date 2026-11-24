/** Verifies clipboard ghosts follow the judge line under the pointer. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createLine, createNote } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { copyObjects } from "../../../core/edit/clipboard/operations.ts";
import { projectClipboardGhost } from "../../../frontend/screens/editor/workspace/timeline/clipboardGhost.ts";

test("clipboard ghosts target the line under the pointer", () => {
  const chart = createChart();
  chart.judgeLineList.push(createLine("Line 2"));
  chart.judgeLineList[0].notes = [createNote(1, 0, 0.5)];
  const session = new EditorSession(chart);
  session.selection = new Set([0]);
  assert.equal(copyObjects(session), 1);

  const projection = projectClipboardGhost({
    appearance: { clipboardGhostEnabled: true },
    gestures: {
      clipboardPointer: { x: 0, y: 20 },
      clipboardMode: {},
      cursorLineIndex: 1,
    },
    viewport: { snappedBeatTriple: () => [0, 4, 1] },
    getSession: () => session,
  });

  assert.equal(projection?.targetLineIndex, 1);
  assert.deepEqual(projection?.noteLines, [1]);
});
