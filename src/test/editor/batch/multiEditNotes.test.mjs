/** Verifies multi-line note batches update each selected note exactly once. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createLine, createNote } from "../../../core/global/chart/chart.ts";
import { assemble, previewMultiEdit } from "../../../core/edit/multiEdit/plan.ts";
import { commitSelectionEdit } from "../../../core/edit/selection/edits.ts";
import { captureSelection } from "../../../core/edit/selection/snapshot.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";

function multiLineNoteSession() {
  const chart = createChart();
  chart.judgeLineList = [createLine("L0"), createLine("L1")];
  chart.judgeLineList[0].notes = [createNote(1, 1, 0), createNote(1, 2, 1)];
  chart.judgeLineList[1].notes = [createNote(1, 3, 2), createNote(1, 4, 3)];
  const session = new EditorSession(chart);
  session.setMultiLineSelection([0, 1], { persist: false });
  session.setMultiLineMode("notes");
  session.multiLineSelection = new Map([
    [0, new Set([0, 1])],
    [1, new Set([0, 1])],
  ]);
  return session;
}

function noteIds(session) {
  return session.chart.judgeLineList.flatMap((line) => line.notes.map((note) => note.id));
}

test("multi-line note batches do not copy notes across lines or during undo", () => {
  const session = multiLineNoteSession();
  const beforeIds = noteIds(session);
  const result = previewMultiEdit(captureSelection(session), "notes", {
    field: "x",
    operation: "By",
    lower: "10",
    upper: "10",
  });

  assert.equal(commitSelectionEdit(session, result, "batch", {}, { normalized: true }), true);
  assert.deepEqual(
    session.chart.judgeLineList.map((line) => line.notes.map((note) => note.positionX)),
    [
      [10, 11],
      [12, 13],
    ],
  );
  assert.equal(noteIds(session).length, 4);
  assert.equal(new Set(noteIds(session)).size, 4);

  assert.equal(session.travel("undo"), true);
  assert.deepEqual(
    session.chart.judgeLineList.map((line) => line.notes.map((note) => note.positionX)),
    [
      [0, 1],
      [2, 3],
    ],
  );
  assert.deepEqual(noteIds(session), beforeIds);
});

test("multi-line note batches resolve sources by note id", () => {
  const session = multiLineNoteSession();
  const snapshot = captureSelection(session);
  const changes = snapshot.notes.map((entry) => ({
    kind: "notes",
    type: "",
    index: entry.index,
    before: structuredClone(entry.note),
    after: { ...structuredClone(entry.note), positionX: entry.note.positionX + 10 },
    lineIndex: entry.lineIndex ?? snapshot.lineIndex,
    copy: false,
  }));

  const result = assemble(snapshot, changes, "notes");

  assert.deepEqual(
    result.chart.judgeLineList.map((line) => line.notes.map((note) => note.positionX)),
    [
      [10, 11],
      [12, 13],
    ],
  );
});
