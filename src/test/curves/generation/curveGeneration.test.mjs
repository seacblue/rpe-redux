/**
 * Verifies curve event generation replaces only truly intersecting events and
 * that the curve-note plan shared by the ghost and the commit never inserts an
 * anchor the chart already holds.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createNote } from "../../../core/global/chart/chart.ts";
import {
  planCurveNotes,
  curvePlanCacheStats,
  resetCurvePlanCache,
} from "../../../core/global/chart/editing/curveNotes.ts";
import { beatValue, fromNumber } from "../../../core/global/chart/timing/beat.ts";
import { buildCurveGhostNotes } from "../../../core/edit/timeline/curveGhost.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { createCurveEditor } from "../../../frontend/screens/editor/inspector/curveNotes/curveEditor.ts";
import { generateCurveEvents } from "../../../frontend/screens/editor/curveEvents/generation.ts";
import { componentFromNodes } from "../../../frontend/screens/editor/curveEvents/pathModel.ts";
import { createValue } from "../../../core/state/values.ts";

/** A straight horizontal path used by every generation case. */
function lineComponent() {
  const component = componentFromNodes(
    "test",
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    { smooth: false },
  );
  assert.ok(component);
  return component;
}

/** A real session whose active line carries the given moveX events. */
function sessionWithMoveX(events) {
  const chart = createChart();
  const [line] = chart.judgeLineList;
  chart.judgeLineList = [{ ...line, eventLayers: [{ moveXEvents: events }] }];
  return new EditorSession(chart);
}

/** A real session whose active line already holds the given notes. */
function sessionWithNotes(notes) {
  const chart = createChart();
  const [line] = chart.judgeLineList;
  chart.judgeLineList = [
    {
      ...line,
      notes,
      numOfNotes: notes.filter((note) => note.type !== 2).length,
    },
  ];
  return new EditorSession(chart);
}

/** Generates the fixed 1..3 curve used by the boundary cases. */
function generate(session, replace = true) {
  return generateCurveEvents(session, {
    component: lineComponent(),
    startBeat: 1,
    endBeat: 3,
    layer: 0,
    cutStepBeats: 1,
    tEasing: 1,
    fit: false,
    fitTolerance: 1,
    replace,
  });
}

/** Builds an anchor note at an exact beat and X. */
function anchorNote(beat, positionX, type = 4) {
  return {
    ...createNote(type, beat, positionX),
    startTime: fromNumber(beat),
    endTime: fromNumber(beat),
  };
}

/** Stable beat/X identity used to compare planned, previewed and committed notes. */
function noteKey(note) {
  return `${beatValue(note.startTime)}@${note.positionX}`;
}

const planOptions = {
  startTime: fromNumber(1),
  endTime: fromNumber(3),
  startX: -100,
  endX: 100,
  type: 4,
  division: 4,
  density: 1,
  easingType: 1,
};

/** Creates a curve editor that captures the notes it hands to the host. */
function editorWithNotes(notes, commitNotes) {
  const fields = createValue({ initial: null });
  const pickMode = createValue({ initial: null });
  const quick = createValue({ initial: null });
  let committed = null;
  const editor = createCurveEditor({
    state: { fields, pickMode, quick },
    getDivision: () => 4,
    getNotes: () => notes,
    setPickMode: pickMode.set,
    activatePane: () => {},
    showSingleNoteTimeline: () => {},
    closePane: () => {},
    invalidate: () => {},
    notify: () => {},
    reportError: (error) => {
      throw error;
    },
    commit:
      commitNotes ??
      ((next) => {
        committed = next;
      }),
  });
  editor.openPanel();
  fields.get()?.onInput({
    startTime: [1, 0, 1],
    endTime: [3, 0, 1],
    startX: -100,
    endX: 100,
    density: 1,
    type: 4,
    easingType: 1,
  });
  return { editor, committed: () => committed };
}

test("replacing a curve range keeps events that only touch its boundaries", () => {
  const left = createEvent(0, 0, 0, 1);
  const right = createEvent(0, 0, 3, 4);
  const result = generate(sessionWithMoveX([left, right]));
  const events = result.chart.judgeLineList[0].eventLayers[0].moveXEvents;

  assert.ok(events.includes(left), "the event ending at the start beat survives");
  assert.ok(events.includes(right), "the event starting at the end beat survives");
  assert.equal(
    events.filter((event) => beatValue(event.startTime) >= 1 && beatValue(event.endTime) <= 3)
      .length,
    2,
    "only the newly generated pieces occupy 1..3",
  );
});

test("replacing a curve range removes an event that crosses it", () => {
  const crossing = createEvent(0, 0, 0.5, 2);
  const result = generate(sessionWithMoveX([crossing]));
  const events = result.chart.judgeLineList[0].eventLayers[0].moveXEvents;

  assert.ok(!events.includes(crossing), "an event strictly overlapping 1..3 is replaced");
  assert.equal(events.length, 2, "the replacement writes both cut pieces");
});

test("a non-replace generation allows adjacent events and rejects an overlap", () => {
  const adjacent = generate(
    sessionWithMoveX([createEvent(0, 0, 0, 1), createEvent(0, 0, 3, 4)]),
    false,
  );
  assert.equal(adjacent.count, 4, "both tracks generate over the free range");

  assert.throws(
    () => generate(sessionWithMoveX([createEvent(0, 0, 0.5, 2)]), false),
    /curve\.range\.occupied/,
  );
});

test("a replacement leaves the event track in time order", () => {
  const early = createEvent(0, 0, 0, 0.5);
  const late = createEvent(0, 0, 5, 6);
  const result = generate(sessionWithMoveX([late, early]));
  const events = result.chart.judgeLineList[0].eventLayers[0].moveXEvents;
  const starts = events.map((event) => beatValue(event.startTime));

  assert.deepEqual(
    starts,
    [...starts].sort((left, right) => left - right),
    "surviving and generated events are stored by start beat",
  );
  assert.ok(events.includes(early), "an earlier event survives before the range");
  assert.ok(events.includes(late), "a later event survives after the range");
  assert.equal(starts[0], 0, "the earlier event stays first");
  assert.equal(starts.at(-1), 5, "the later event stays last");
});

test("a rejected generation leaves focus and selection untouched", () => {
  const collaborationSession = sessionWithMoveX([]);
  collaborationSession.collaborationReadOnly = true;
  assert.throws(() => generate(collaborationSession), /curve\.readonly/);

  const rejectedSession = sessionWithMoveX([]);
  rejectedSession.focus = "notes";
  rejectedSession.selection = new Set([7]);
  rejectedSession.commitChart = () => false;
  assert.throws(() => generate(rejectedSession), /curve\.readonly/);
  assert.equal(rejectedSession.focus, "notes");
  assert.deepEqual([...rejectedSession.selection], [7]);
  assert.equal(rejectedSession.eventLayer, 0);
});

test("a plan reuses anchors already present and keeps the generated points", () => {
  const start = anchorNote(1, -100);
  const end = anchorNote(3, 100);
  const plan = planCurveNotes({ ...planOptions, existing: [start, end] });

  assert.equal(plan.items[0].existing, true, "the start anchor is marked as present");
  assert.equal(plan.items.at(-1).existing, true, "the end anchor is marked as present");
  assert.equal(plan.generated.length, 7);
  assert.equal(plan.notes.length, 7, "only intermediate notes are inserted");
  assert.ok(!plan.notes.some((note) => noteKey(note) === noteKey(start)));
  assert.ok(!plan.notes.some((note) => noteKey(note) === noteKey(end)));
});

test("a plan inserts anchors the chart does not hold", () => {
  const start = anchorNote(1, -100);
  const plan = planCurveNotes({ ...planOptions, existing: [start] });

  assert.equal(plan.items[0].existing, true);
  assert.equal(plan.items.at(-1).existing, false);
  assert.equal(plan.notes.length, 8, "seven generated points plus the missing end anchor");
  assert.equal(noteKey(plan.notes.at(-1)), noteKey(anchorNote(3, 100)));
});

test("a Hold curve gives every generated note one division of body", () => {
  const plan = planCurveNotes({ ...planOptions, type: 2, division: 4 });

  assert.ok(plan.items.length > 2);
  for (const { note } of plan.items) {
    assert.equal(note.type, 2);
    assert.equal(
      beatValue(note.endTime) - beatValue(note.startTime),
      0.25,
      "one of four horizontal lines in a beat",
    );
  }
});

test("committing reuses existing anchors and the ghost previews the same inserts", () => {
  const existing = [anchorNote(1, -100), anchorNote(3, 100)];
  const { editor, committed } = editorWithNotes(existing);
  resetCurvePlanCache();
  const ghost = editor.ghost();
  const ghostInserts = ghost.filter((note) => !note.existing);
  const reused = ghost.filter((note) => note.existing);

  assert.equal(reused.length, 2, "both existing anchors stay on the preview path");
  assert.equal(ghostInserts.length, 7);

  const afterGhost = curvePlanCacheStats();
  editor.generate();
  const afterCommit = curvePlanCacheStats();
  assert.equal(afterCommit.misses, afterGhost.misses, "the commit reuses the ghost plan");
  assert.equal(afterCommit.hits, afterGhost.hits + 1, "the commit is a plan cache hit");
  const inserted = committed();
  assert.equal(inserted.length, 7, "the existing anchors are not inserted again");
  assert.ok(!inserted.some((note) => noteKey(note) === noteKey(existing[0])));
  assert.ok(!inserted.some((note) => noteKey(note) === noteKey(existing[1])));
  assert.deepEqual(
    inserted.map(noteKey),
    ghostInserts.map(noteKey),
    "the commit inserts exactly the notes the ghost drew",
  );
});

test("committing without existing anchors inserts both anchors", () => {
  const { editor, committed } = editorWithNotes([]);
  const ghost = editor.ghost();

  assert.equal(ghost.filter((note) => !note.existing).length, 9);
  editor.generate();
  const inserted = committed();
  assert.equal(inserted.length, 9);
  assert.equal(noteKey(inserted[0]), "1@-100");
  assert.equal(noteKey(inserted.at(-1)), "3@100");
  assert.deepEqual(inserted.map(noteKey), ghost.filter((note) => !note.existing).map(noteKey));
});

test("a session insert keeps existing anchors and counts each note once", () => {
  const existing = [anchorNote(1, -100), anchorNote(3, 100)];
  const session = sessionWithNotes(existing);
  const { editor } = editorWithNotes(session.notes, (notes) => session.insertNotes(notes));

  editor.generate();

  assert.equal(session.notes.length, 9, "two anchors plus seven generated points");
  assert.equal(session.chart.judgeLineList[0].numOfNotes, 9, "the score is not counted twice");
  assert.equal(
    session.notes.filter((note) => noteKey(note) === noteKey(existing[0])).length,
    1,
    "the start anchor stays unique",
  );
  assert.equal(
    session.notes.filter((note) => noteKey(note) === noteKey(existing[1])).length,
    1,
    "the end anchor stays unique",
  );
});

test("the ghost reports a failed generation but still marks existing anchors", () => {
  const existing = [anchorNote(1, -100)];
  const errors = [];
  const ghost = buildCurveGhostNotes(
    true,
    { startTime: [1, 0, 1], positionX: -100, type: 4 },
    { startTime: [0, 0, 1], positionX: 100, type: 4 },
    {
      startTime: [1, 0, 1],
      endTime: [0, 0, 1],
      startX: -100,
      endX: 100,
      type: 4,
      density: 1,
      easingType: 1,
    },
    4,
    existing,
    (error) => errors.push(error),
  );

  assert.equal(errors.length, 0, "a reversed selection is not an error");
  assert.deepEqual(
    ghost.map((note) => [noteKey(note), note.existing]),
    [["1@-100", true]],
  );
});
