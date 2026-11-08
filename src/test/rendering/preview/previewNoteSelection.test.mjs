/** Preview note picking must replace, not extend, the selected judge lines. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createLine, createNote } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { applySelection } from "../../../frontend/screens/editor/workspace/preview/interaction/previewNoteSelection.ts";

/** Builds a three-line chart with one note on every line. */
function chartWithNotes() {
  const chart = createChart();
  chart.judgeLineList.push(createLine("Line 2"), createLine("Line 3"));
  for (const line of chart.judgeLineList) {
    line.notes = [createNote(1, 0, 0)];
  }
  return chart;
}

test("a preview note click replaces the selected lines with the note's line", () => {
  const session = new EditorSession(chartWithNotes());
  session.multiLineEnabled = true;
  session.multiLineMode = "notes";
  session.multiLineIndices = [0, 2];
  session.multiLineSelection = new Map([
    [0, new Set([0])],
    [2, new Set([0])],
  ]);
  session.selection = new Set([0]);

  applySelection(session, new Map([[1, new Set([0])]]), false);

  assert.equal(session.lineIndex, 1);
  assert.deepEqual(session.multiLineIndices, []);
  assert.equal(session.multiLineEnabled, false);
  assert.deepEqual([...session.selection], [0]);
  assert.equal(session.selectionMode, "single");
  assert.equal(session.focus, "notes");
});

test("a preview marquee keeps only the lines that own the selected notes", () => {
  const session = new EditorSession(chartWithNotes());
  session.multiLineEnabled = true;
  session.multiLineMode = "notes";
  session.multiLineIndices = [0, 1, 2];
  session.multiLineSelection = new Map([
    [0, new Set([0])],
    [2, new Set([0])],
  ]);

  applySelection(
    session,
    new Map([
      [0, new Set([0])],
      [2, new Set([0])],
    ]),
    false,
  );

  assert.deepEqual(session.multiLineIndices, [0, 2]);
  assert.equal(session.multiLineEnabled, true);
  assert.equal(session.multiLineMode, "notes");
  assert.equal(session.selectionMode, "single");
  assert.deepEqual([...session.multiLineSelection.keys()].sort(), [0, 2]);
});

test("a cross-line marquee moves the active line into the selected lines", () => {
  const session = new EditorSession(chartWithNotes());
  applySelection(
    session,
    new Map([
      [1, new Set([0])],
      [2, new Set([0])],
    ]),
    false,
    true,
  );
  assert.deepEqual(session.targetLineIndices, [1, 2]);
  assert.equal(session.lineIndex, 1);
  assert.deepEqual([...session.selection], [0]);
  assert.equal(session.marqueeSelection, "notes");
  assert.equal(session.selectionMode, "multi");
});

test("preview selection history restores active line and multi-line selection", () => {
  const session = new EditorSession(chartWithNotes());
  const before = session.selectionState();
  applySelection(
    session,
    new Map([
      [1, new Set([0])],
      [2, new Set([0])],
    ]),
    false,
    true,
  );
  session.recordSelection(undefined, before, false);
  assert.equal(session.travel("undo"), true);
  assert.equal(session.lineIndex, 0);
  assert.deepEqual(session.targetLineIndices, [0]);
  assert.equal(session.travel("redo"), true);
  assert.equal(session.lineIndex, 1);
  assert.deepEqual(session.targetLineIndices, [1, 2]);
});

test("reapplying a multi-line selection repairs a stale active line", () => {
  const session = new EditorSession(chartWithNotes());
  session.multiLineEnabled = true;
  session.multiLineMode = "notes";
  session.multiLineIndices = [1, 2];
  session.multiLineSelection = new Map([
    [1, new Set([0])],
    [2, new Set([0])],
  ]);
  session.lineIndex = 0;
  applySelection(
    session,
    new Map([
      [1, new Set([0])],
      [2, new Set([0])],
    ]),
    false,
  );
  assert.equal(session.lineIndex, 1);
  assert.deepEqual([...session.selection], [0]);
});

test("selecting one preview note clears previous event selections", () => {
  const session = new EditorSession(chartWithNotes());
  session.eventSelection.add("moveXEvents:0");
  session.multiEventSelection.set(0, new Set(["moveXEvents:0"]));
  applySelection(session, new Map([[2, new Set([0])]]), false);
  assert.equal(session.eventSelection.size, 0);
  assert.equal(session.multiEventSelection.size, 0);
  assert.equal(session.lineIndex, 2);
});
