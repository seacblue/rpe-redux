/** Exercises conflict-aware compensation of interleaved chart edits. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createNote } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { selectiveUndo, selectiveUndoLatest } from "../../../core/edit/session/selectiveUndo.ts";

function fixture() {
  const chart = createChart();
  chart.judgeLineList[0].notes = [createNote(1, 1, 0), createNote(1, 2, 1)];
  return new EditorSession(chart);
}
function edit(session, label, update) {
  const chart = session.chart;
  const lines = [...chart.judgeLineList];
  const line = lines[0];
  const notes = line.notes.map((note, index) => update(note, index));
  lines[0] = { ...line, notes };
  assert.equal(session.commitChart(label, { ...chart, judgeLineList: lines }), true);
  return session.history.undoStack.at(-1).id;
}

test("selective undo preserves another actor's later note changes", () => {
  const session = fixture();
  const id = edit(session, "A", (n, i) => (i === 0 ? { ...n, positionX: 20 } : n));
  edit(session, "B", (n, i) => (i === 1 ? { ...n, positionX: 30 } : n));
  const result = selectiveUndo(session, id, "undo A");
  assert.equal(result.status, "committed");
  assert.deepEqual(
    session.chart.judgeLineList[0].notes.map((n) => n.positionX),
    [0, 30],
  );
  assert.equal(session.history.undoStack.length, 3);
  session.travel("undo");
  assert.deepEqual(
    session.chart.judgeLineList[0].notes.map((n) => n.positionX),
    [20, 30],
  );
  session.travel("redo");
  assert.deepEqual(
    session.chart.judgeLineList[0].notes.map((n) => n.positionX),
    [0, 30],
  );
});

test("selective undo rejects a later edit to the same field atomically", () => {
  const session = fixture();
  const id = edit(session, "A", (n, i) => (i === 0 ? { ...n, positionX: 20 } : n));
  edit(session, "B", (n, i) => (i === 0 ? { ...n, positionX: 30 } : n));
  const before = session.chart;
  const result = selectiveUndo(session, id, "undo A");
  assert.equal(result.status, "conflict");
  assert.equal(session.chart, before);
  assert.equal(session.history.undoStack.length, 2);
});

test("selective undo preserves unrelated fields on the same note", () => {
  const session = fixture();
  const id = edit(session, "A", (n, i) => (i === 0 ? { ...n, positionX: 20 } : n));
  edit(session, "B", (n, i) => (i === 0 ? { ...n, alpha: 100 } : n));
  assert.equal(selectiveUndo(session, id, "undo A").status, "committed");
  assert.equal(session.chart.judgeLineList[0].notes[0].positionX, 0);
  assert.equal(session.chart.judgeLineList[0].notes[0].alpha, 100);
});

test("deleted notes return with the same ID while later insertions and selection survive", () => {
  const session = fixture();
  const first = session.notes[0];
  const chart = session.chart;
  const line = chart.judgeLineList[0];
  session.commitChart("delete", {
    ...chart,
    judgeLineList: [{ ...line, notes: line.notes.slice(1) }],
  });
  const id = session.history.undoStack.at(-1).id;
  session.selection.add(0);
  const secondId = session.notes[0].id;
  const next = session.chart;
  session.commitChart("insert", {
    ...next,
    judgeLineList: [
      { ...next.judgeLineList[0], notes: [...next.judgeLineList[0].notes, createNote(1, 3, 5)] },
    ],
  });
  assert.equal(selectiveUndo(session, id, "restore").status, "committed");
  assert.equal(session.notes[0].id, first.id);
  assert.equal(session.notes.length, 3);
  assert.equal(session.notes[[...session.selection][0]].id, secondId);
  session.travel("undo");
  assert.equal(session.notes.length, 2);
  assert.equal(session.notes[[...session.selection][0]].id, secondId);
});

test("undoing an insertion rejects an object subsequently changed by another actor", () => {
  const session = fixture();
  const chart = session.chart;
  session.commitChart("insert", {
    ...chart,
    judgeLineList: [
      { ...chart.judgeLineList[0], notes: [...chart.judgeLineList[0].notes, createNote(1, 3, 5)] },
    ],
  });
  const id = session.history.undoStack.at(-1).id;
  edit(session, "change", (note, index) => (index === 2 ? { ...note, positionX: 77 } : note));
  const current = session.chart;
  assert.equal(selectiveUndo(session, id, "undo").status, "conflict");
  assert.equal(session.chart, current);
});

test("event edits on the same layer can be compensated independently", () => {
  const chart = createChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(0, 1), createEvent(1, 2)];
  const session = new EditorSession(chart);
  const change = (index, value) => {
    const source = session.chart;
    const line = source.judgeLineList[0];
    const layer = line.eventLayers[0];
    const moveXEvents = layer.moveXEvents.map((event, i) =>
      i === index ? { ...event, start: value } : event,
    );
    session.commitChart("event", {
      ...source,
      judgeLineList: [{ ...line, eventLayers: [{ ...layer, moveXEvents }] }],
    });
    return session.history.undoStack.at(-1).id;
  };
  const oldValue = session.chart.judgeLineList[0].eventLayers[0].moveXEvents[0].start;
  const id = change(0, 20);
  change(1, 30);
  assert.equal(selectiveUndo(session, id, "undo").status, "committed");
  const events = session.chart.judgeLineList[0].eventLayers[0].moveXEvents;
  assert.equal(events[0].start, oldValue);
  assert.equal(events[1].start, 30);
});

test("collaborative undo walks back original transactions instead of compensations", () => {
  const session = fixture();
  session.setCollaborationAccess(true, false);
  session.setCollaborationActor("actor");
  edit(session, "A", (note, index) => (index === 0 ? { ...note, positionX: 20 } : note));
  edit(session, "B", (note, index) => (index === 1 ? { ...note, positionX: 30 } : note));
  assert.equal(selectiveUndoLatest(session, "undo B").status, "committed");
  assert.deepEqual(
    session.chart.judgeLineList[0].notes.map((note) => note.positionX),
    [20, 1],
  );
  assert.equal(selectiveUndoLatest(session, "undo A").status, "committed");
  assert.deepEqual(
    session.chart.judgeLineList[0].notes.map((note) => note.positionX),
    [0, 1],
  );
  assert.equal(selectiveUndoLatest(session, "nothing left").status, "unavailable");
});

test("interval endpoints changed by different edits conflict", () => {
  const session = fixture();
  const id = edit(session, "start", (note, index) =>
    index === 0 ? { ...note, startTime: [2, 0, 1] } : note,
  );
  edit(session, "end", (note, index) => (index === 0 ? { ...note, endTime: [3, 0, 1] } : note));
  const current = session.chart;
  assert.equal(selectiveUndo(session, id, "undo").status, "conflict");
  assert.equal(session.chart, current);
});
