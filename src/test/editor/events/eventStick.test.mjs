/**
 * Sticking joins an event's value to its neighbour on the same track: the next
 * event's start value becomes the selected event's end, and the previous
 * event's end value becomes its start.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createLine } from "../../../core/global/chart/chart.ts";
import { stickSelectedEvents } from "../../../core/edit/events/eventTools.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";

/** One line whose moveX track holds values at beats 0-1, 1-2, and 2-3. */
function stickSession() {
  const chart = createChart();
  const line = createLine("Stick");
  line.eventLayers[0].moveXEvents = [
    createEvent(10, 20, 0, 1),
    createEvent(30, 40, 1, 2),
    createEvent(50, 60, 2, 3),
  ];
  chart.judgeLineList = [line];
  const session = new EditorSession(chart);
  session.focus = "events";
  return session;
}

/** Read the moveX track back as start/end value pairs. */
function values(session) {
  return session.chart.judgeLineList[0].eventLayers[0].moveXEvents.map((event) => [
    event.start,
    event.end,
  ]);
}

test("sticking to the next event writes its start value into the selected end", () => {
  const session = stickSession();
  session.eventSelection = new Set(["moveXEvents:0"]);

  assert.deepEqual(stickSelectedEvents(session, "next"), { changed: 1, skipped: 0 });
  assert.deepEqual(values(session), [
    [10, 30],
    [30, 40],
    [50, 60],
  ]);
  assert.equal(session.history.undoStack.length, 1);
});

test("sticking to the previous event writes its end value into the selected start", () => {
  const session = stickSession();
  session.eventSelection = new Set(["moveXEvents:2"]);

  assert.deepEqual(stickSelectedEvents(session, "previous"), { changed: 1, skipped: 0 });
  assert.deepEqual(values(session), [
    [10, 20],
    [30, 40],
    [40, 60],
  ]);
});

test("a selection without a neighbour in that direction is skipped", () => {
  const session = stickSession();
  session.eventSelection = new Set(["moveXEvents:2"]);
  assert.deepEqual(stickSelectedEvents(session, "next"), { changed: 0, skipped: 1 });

  session.eventSelection = new Set(["moveXEvents:0"]);
  assert.deepEqual(stickSelectedEvents(session, "previous"), { changed: 0, skipped: 1 });
  assert.equal(session.history.undoStack.length, 0);
});

test("a stuck hooked event keeps both anchors equal", () => {
  const session = stickSession();
  const hook = createEvent(70, 70, 1, 2);
  hook.inst = 1;
  session.chart.judgeLineList[0].eventLayers[0].moveXEvents[1] = hook;
  session.eventSelection = new Set(["moveXEvents:1"]);

  stickSelectedEvents(session, "next");
  assert.deepEqual(values(session)[1], [50, 50]);
});

test("sticking a run chains through the value the previous edit wrote", () => {
  const session = stickSession();
  session.eventSelection = new Set(["moveXEvents:0", "moveXEvents:1"]);

  stickSelectedEvents(session, "next");
  assert.deepEqual(values(session), [
    [10, 30],
    [30, 50],
    [50, 60],
  ]);
  assert.equal(session.history.undoStack.length, 1);
});

test("an event already touching its neighbour reports no change", () => {
  const session = stickSession();
  session.chart.judgeLineList[0].eventLayers[0].moveXEvents[0].end = 30;
  session.eventSelection = new Set(["moveXEvents:0"]);

  assert.deepEqual(stickSelectedEvents(session, "next"), { changed: 0, skipped: 0 });
  assert.equal(session.history.undoStack.length, 0);
});
