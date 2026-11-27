/**
 * A merged multi-line note field paints every selected line in one panel, so a
 * single click must be able to hit a note on any of them; a split field still
 * hits only the panel under the pointer.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createLine, createNote } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { hit } from "../../../frontend/screens/editor/workspace/timeline/notes/noteHitTest.ts";

/** A five-line note session whose last line carries the only note. */
function sessionWithNoteOnLastLine(merge) {
  const chart = createChart();
  chart.judgeLineList = [0, 1, 2, 3, 4].map((index) => createLine(`L${index}`));
  chart.judgeLineList[4].notes = [createNote(1, 4, 0)];
  chart.judgeLineList[4].numOfNotes = 1;
  const session = new EditorSession(chart);
  session.multiLineEnabled = true;
  session.multiLineMode = "notes";
  session.multiLineIndices = [0, 1, 2, 3, 4];
  session.multiLineMerge = merge;
  return session;
}

/**
 * A hit-test receiver for one presentation.
 *
 * Every line shares the same projection, so the only thing that decides whether
 * the last line's note is reachable is the line list the hit test asks for.
 */
function fakeReceiver(session, { panelCount, panelLine }) {
  const entriesFor = (lineIndex) =>
    (session.chart.judgeLineList?.[lineIndex]?.notes ?? []).map((item, index) => ({
      item,
      index,
      lineIndex,
      start: 4,
      end: 4,
    }));
  return {
    notesCanvas: { clientWidth: 1000 },
    appearance: { overlapThreshold: 0, skin: null },
    getSession: () => session,
    // The live timeline mixes the module's `visible` in as a method; the fake
    // supplies the same contract for one line.
    visible: (lineIndex) => entriesFor(lineIndex),
    viewport: {
      panelCount: () => panelCount,
      lineIndexAt: () => panelLine,
      noteBeatRangeForLine: () => [0, 100],
      noteHorizontal: () => 500,
      clampNoteHorizontal: (horizontal) => horizontal,
      noteWidth: () => 68,
      noteVerticalForLine: (beat) => 100 + beat,
    },
    cache: {
      setNoteChangeHints() {},
      refreshNotes() {},
      visibleNotes: (lineIndex) => entriesFor(lineIndex),
      noteIndex: (lineIndex) => ({
        notes: entriesFor(lineIndex).map((entry) => entry.item),
      }),
      noteOverlapRanks: () => new Map(),
    },
  };
}

test("a merged field hits a note on a line that is not the active one", () => {
  const session = sessionWithNoteOnLastLine(true);
  const receiver = fakeReceiver(session, { panelCount: 1, panelLine: 0 });

  const entry = hit.call(receiver, { x: 500, y: 104 });

  assert.equal(entry?.lineIndex, 4, "the click reaches the selected line that owns the note");
  assert.equal(entry?.index, 0);
});

test("a split field still hits only the panel under the pointer", () => {
  const session = sessionWithNoteOnLastLine(false);
  const receiver = fakeReceiver(session, { panelCount: 5, panelLine: 0 });

  assert.equal(
    hit.call(receiver, { x: 500, y: 104 }),
    undefined,
    "the pointer is over panel 0, which has no note",
  );

  receiver.viewport.lineIndexAt = () => 4;
  assert.equal(hit.call(receiver, { x: 500, y: 104 })?.lineIndex, 4);
});
