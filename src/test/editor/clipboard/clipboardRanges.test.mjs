/**
 * Clipboard time ranges: the strip marker's source span, the paste marker's
 * projected span, and the history range used by undo jump.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createNote } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import {
  clipboardBeatRange,
  clipboardShortcuts,
  copyObjects,
  deleteObjects,
  pasteObjects,
} from "../../../core/edit/clipboard/operations.ts";
import { createHistoryTravel } from "../../../core/edit/operations/editing.ts";

/** A chart with one line holding the supplied notes and move-X events. */
function chartWith(notes, events) {
  const chart = createChart();
  chart.judgeLineList[0].notes = notes;
  chart.judgeLineList[0].eventLayers[0].moveXEvents = events;
  return chart;
}

test("clipboard range spans the earliest start and latest end", () => {
  const session = new EditorSession(
    chartWith([createNote(2, 4, 0, 7), createNote(1, 10, 0)], [createEvent(0, 1, 2, 12)]),
  );
  session.selection = new Set([0, 1]);
  session.eventSelection = new Set(["moveXEvents:0"]);

  assert.equal(copyObjects(session), 3);
  assert.deepEqual(clipboardBeatRange(session), { start: 2, end: 12 });
});

test("a paste records its projected span for the strip and history", () => {
  const session = new EditorSession(
    chartWith([createNote(2, 4, 0, 7), createNote(1, 10, 0)], [createEvent(0, 1, 2, 12)]),
  );
  session.selection = new Set([0, 1]);
  session.eventSelection = new Set(["moveXEvents:0"]);
  copyObjects(session);

  assert.equal(pasteObjects(session, 20, { targetLineIndex: 0 }), true);
  assert.deepEqual(session.lastPasteBeatRange, { start: 20, end: 30 });
  assert.deepEqual(session.history.undoStack.at(-1).beatRange, { start: 20, end: 30 });

  assert.equal(session.travel("undo"), true);
  assert.deepEqual(session.lastEditBeatRange, { start: 20, end: 30 });
  assert.equal(session.travel("redo"), true);
  assert.deepEqual(session.lastEditBeatRange, { start: 20, end: 30 });
});

test("a deletion records the selected beat span for undo jump", () => {
  const session = new EditorSession(chartWith([createNote(1, 100, 0)], []));
  session.selection = new Set([0]);

  assert.equal(deleteObjects(session), 1);
  assert.deepEqual(session.history.undoStack.at(-1).beatRange, { start: 100, end: 100 });
  assert.equal(session.travel("undo"), true);
  assert.deepEqual(session.lastEditBeatRange, { start: 100, end: 100 });
});

test("clipboard navigation has no default while clearing has one", () => {
  const byId = new Map(clipboardShortcuts.map((shortcut) => [shortcut.id, shortcut]));
  assert.deepEqual(byId.get("edit.clipboard.jumpStart")?.defaults, []);
  assert.deepEqual(byId.get("edit.clipboard.jumpEnd")?.defaults, []);
  assert.deepEqual(byId.get("edit.clipboard.clear")?.defaults, [
    { key: "DELETE", modifiers: ["CTRL", "SHIFT"] },
  ]);
});

test("history travel reveals the successful entry range only", () => {
  const session = new EditorSession(chartWith([createNote(1, 12, 0)], []));
  session.selection = new Set([0]);
  deleteObjects(session);
  const jumped = [];
  const travel = createHistoryTravel({
    getSession: () => session,
    cancelPlacement: () => {},
    notify: () => {},
    jumpToEdit: (range) => jumped.push(range),
  });

  assert.equal(session.history.undoStack.length, 1);
  travel.travel("undo");
  assert.deepEqual(jumped, [{ start: 12, end: 12 }]);
  travel.travel("undo");
  assert.deepEqual(jumped, [{ start: 12, end: 12 }]);
  travel.travel("redo");
  assert.deepEqual(jumped, [
    { start: 12, end: 12 },
    { start: 12, end: 12 },
  ]);
});
