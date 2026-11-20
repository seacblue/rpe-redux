/**
 * A pointer placement in merged multi-line mode belongs to the active judge
 * line, not to whichever selected line owns the next note ahead.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createLine, createNote } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { placeNoteAtTarget } from "../../../core/edit/timeline/noteCommands.ts";

/** A two-line chart with merged notes and line 1 active. */
function mergedSession() {
  const chart = createChart();
  chart.judgeLineList = [createLine("A"), createLine("B")];
  const session = new EditorSession(chart);
  session.setMultiLineSelection([0, 1]);
  session.setMultiLineMerge(true);
  session.selectLine(1);
  return session;
}

test("a note added in merged mode belongs to the active line", () => {
  const session = mergedSession();
  assert.equal(session.insertNotesAt(0, [createNote(1, 10, 0)]), true);

  const result = placeNoteAtTarget(session, 1, {
    lineIndex: 1,
    from: { beat: 5, positionX: 0 },
  });

  assert.equal(result.status, "committed");
  assert.deepEqual(
    session.chart.judgeLineList[1].notes.map((note) => note.startTime),
    [[5, 0, 1]],
  );
  assert.equal(session.chart.judgeLineList[0].notes.length, 1, "line 0 keeps only its own note");
});
