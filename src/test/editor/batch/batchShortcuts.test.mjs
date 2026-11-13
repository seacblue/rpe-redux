/** Keyboard batch transforms replace the former drag handles. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
} from "../../../core/global/chart/chart.ts";
import { beatValue } from "../../../core/global/chart/timing/beat.ts";
import {
  scaleSelection,
  shiftEventEdge,
  shiftSelectionLine,
} from "../../../core/edit/selection/control.ts";
import { nudgeSelection } from "../../../core/edit/selection/edits.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";

function noteSession() {
  const chart = createChart();
  chart.judgeLineList.push(createLine("Line 2"));
  chart.judgeLineList[0].notes = [
    createNote(1, 0, -100),
    createNote(1, 1, 0),
    createNote(1, 2, 100),
  ];
  const session = new EditorSession(chart);
  session.selection = new Set([0, 1, 2]);
  session.focus = "notes";
  return session;
}

test("scale shortcut keeps the centre and changes every selected X", () => {
  const session = noteSession();
  assert.equal(scaleSelection(session, 1.1), true);
  assert.deepEqual(
    session.chart.judgeLineList[0].notes.map((note) => Math.round(Number(note.positionX))),
    [-110, 0, 110],
  );
  assert.equal(session.history.undoStack.length, 1);
});

test("line shortcut moves the whole selection to the next line", () => {
  const session = noteSession();
  assert.equal(shiftSelectionLine(session, 1), true);
  assert.equal(session.chart.judgeLineList[0].notes.length, 0);
  assert.equal(session.chart.judgeLineList[1].notes.length, 3);
});

test("event edge shortcuts move only one endpoint", () => {
  const chart = createChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(0, 100, 0, 4)];
  const session = new EditorSession(chart);
  session.focus = "events";
  session.eventSelection = new Set(["moveXEvents:0"]);

  assert.equal(shiftEventEdge(session, "start", 1, 4), true);
  let event = session.chart.judgeLineList[0].eventLayers[0].moveXEvents[0];
  assert.equal(beatValue(event.startTime), 0.25);
  assert.equal(beatValue(event.endTime), 4);

  assert.equal(shiftEventEdge(session, "end", -1, 4), true);
  event = session.chart.judgeLineList[0].eventLayers[0].moveXEvents[0];
  assert.equal(beatValue(event.startTime), 0.25);
  assert.equal(beatValue(event.endTime), 3.75);
});

test("horizontal selection nudges move by half a vertical grid spacing", () => {
  const session = noteSession();
  assert.equal(nudgeSelection(session, "ArrowRight", 4, 11), true);
  assert.equal(session.chart.judgeLineList[0].notes[0].positionX, -32.5);
  assert.equal(session.chart.judgeLineList[0].notes[1].positionX, 67.5);
  assert.equal(session.chart.judgeLineList[0].notes[2].positionX, 167.5);
});
