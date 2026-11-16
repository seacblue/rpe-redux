/** Event-field edits commit once, validate their own track, and leave full gates intact. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
  createNote,
  serializeChart,
} from "../../../core/global/chart/chart.ts";
import { beatValue } from "../../../core/global/chart/timing/beat.ts";
import { fromNumber } from "../../../core/global/chart/timing/beat.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import {
  transformEvents,
  assertMultiEventSelectionStructure,
} from "../../../core/edit/events/eventEdits.ts";
import { editCapturedSelection, commitSelectionEdit } from "../../../core/edit/selection/edits.ts";
import { captureSelection } from "../../../core/edit/selection/snapshot.ts";
import { shiftSelectedEvents } from "../../../core/edit/timeline/selection.ts";
import { insertEventAt, updateEventsAtTarget } from "../../../core/edit/events/eventCommands.ts";
import { deleteObjects, pasteObjects } from "../../../core/edit/clipboard/operations.ts";
import "../../../core/settings/features/editingSettings.ts";
import { values } from "../../../core/state/values.ts";
import { validateChartTransaction } from "../../../core/edit/transaction/preview.ts";
import { extensionRegistry } from "../../../core/extensions/runtime.ts";

/** A session with one selected event on a fresh chart. */
function eventSession(type = "moveXEvents", event = createEvent(0, 0, 0, 4)) {
  const chart = createChart();
  if (type === "moveXEvents") {
    chart.judgeLineList[0].eventLayers[0][type] = [event];
  } else {
    chart.judgeLineList[0].extended = { [type]: [event] };
  }
  const session = new EditorSession(chart);
  session.lineIndex = 0;
  session.eventLayer = 0;
  session.focus = "events";
  session.eventSelection = new Set([`${type}:0`]);
  return session;
}

/** Counts calls to the session's one chart-commit boundary. */
function countCommits(session) {
  const original = session.commitChart.bind(session);
  let count = 0;
  session.commitChart = (...args) => {
    count += 1;
    return original(...args);
  };
  return () => count;
}

/** Build a session with matching X/Y events so binding edits have a counterpart. */
function xyBoundEventSession() {
  const chart = createChart();
  const xEvent = createEvent(0, 10, 2, 6);
  const yEvent = createEvent(20, 30, 2, 6);
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [xEvent];
  chart.judgeLineList[0].eventLayers[0].moveYEvents = [yEvent];
  const session = new EditorSession(chart);
  session.lineIndex = 0;
  session.eventLayer = 0;
  session.focus = "events";
  return session;
}

test("one event-field edit commits once and a repeated value is deduped", () => {
  const session = eventSession();
  const commits = countCommits(session);

  transformEvents(session, "edit", (event) => ({ ...event, start: 42 }));
  assert.equal(commits(), 1);
  assert.equal(session.history.undoStack.length, 1);
  const committedChart = session.chart;

  // The old field wired both `onInput` and `onChange`; a second call with the
  // same value must not produce a second undo entry.
  transformEvents(session, "edit", (event) => ({ ...event, start: 42 }));
  assert.equal(commits(), 1);
  assert.equal(session.history.undoStack.length, 1);
  assert.equal(session.chart, committedChart);
});

test("an event edit with a reversed range commits silently for render filtering", () => {
  const session = eventSession();

  assert.doesNotThrow(() =>
    transformEvents(session, "reverse range", (event) => ({
      ...event,
      startTime: fromNumber(5),
      endTime: fromNumber(2),
    })),
  );
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveXEvents[0].startTime[0], 5);
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveXEvents[0].endTime[0], 2);
});

test("the affected event track rejects NaN, wrong value shapes, and malformed easing", () => {
  const nanSession = eventSession();
  const nanCommits = countCommits(nanSession);
  assert.throws(
    () => transformEvents(nanSession, "bad", (event) => ({ ...event, start: Number.NaN })),
    /invalid event start\/end value/i,
  );
  assert.equal(nanCommits(), 0);
  assert.equal(nanSession.history.undoStack.length, 0);

  const colorSession = eventSession("colorEvents", createEvent([0, 0, 0], [0, 0, 0], 0, 4));
  assert.throws(
    () => transformEvents(colorSession, "bad", (event) => ({ ...event, start: [0, 0] })),
    /invalid event start\/end value/i,
  );

  const easingSession = eventSession();
  assert.throws(
    () =>
      transformEvents(easingSession, "bad", (event) => ({
        ...event,
        easingLeft: Number.POSITIVE_INFINITY,
      })),
    /finite number/i,
  );
});

test("multi-line event edits validate their touched tracks, not unrelated lines", () => {
  const chart = createChart();
  chart.judgeLineList.push(createChart().judgeLineList[0]);
  chart.judgeLineList[1].notes = [createNote(1, 0, 0)];
  chart.judgeLineList[1].notes[0].speed = Number.NaN;
  const touched = new Map([[0, new Set(["moveXEvents:0"])]]);

  assert.doesNotThrow(() => assertMultiEventSelectionStructure(chart, 0, touched));

  chart.judgeLineList[0].eventLayers[0].moveXEvents[0].start = Number.NaN;
  assert.throws(
    () => assertMultiEventSelectionStructure(chart, 0, touched),
    /invalid event start\/end value/i,
  );
});

test("input skips the full gate while save and transaction preview keep it", () => {
  const session = eventSession();
  session.chart.judgeLineList[0].notes = [createNote(1, 0, 0)];
  session.chart.judgeLineList[0].notes[0].speed = Number.NaN;
  let fullValidations = 0;
  const dispose = extensionRegistry.onHook(
    "chart:validate",
    () => {
      fullValidations += 1;
    },
    { owner: "test:event-edit-gates" },
  );
  try {
    transformEvents(session, "edit", (event) => ({ ...event, start: 7 }));
    assert.equal(fullValidations, 0);
    assert.equal(session.history.undoStack.length, 1);

    assert.throws(() => serializeChart(session.chart), /must be a finite number/i);
    assert.equal(fullValidations, 1);

    const preview = validateChartTransaction(session, {
      label: "edit",
      metadata: { name: "changed" },
    });
    assert.equal(preview.status, "rejected");
    assert.ok(preview.issues.some((entry) => entry.code === "chart.validation.failed"));
    assert.equal(fullValidations, 2);
  } finally {
    dispose();
  }
});

test("XY binding creates the missing counterpart with the same span", () => {
  const previous = values.byId.get("xy-binding");
  try {
    values.byId.set("xy-binding", true);
    const chart = createChart();
    chart.judgeLineList[0].eventLayers[0].moveXEvents = [];
    chart.judgeLineList[0].eventLayers[0].moveYEvents = [];
    const session = new EditorSession(chart);

    insertEventAt(session, 0, "moveXEvents", createEvent(12, 24, 2, 5));

    const xEvent = session.chart.judgeLineList[0].eventLayers[0].moveXEvents[0];
    const yEvent = session.chart.judgeLineList[0].eventLayers[0].moveYEvents[0];
    assert.equal(
      xEvent.startTime[0] / xEvent.startTime[1],
      yEvent.startTime[0] / yEvent.startTime[1],
    );
    assert.equal(xEvent.endTime[0] / xEvent.endTime[1], yEvent.endTime[0] / yEvent.endTime[1]);
    assert.notEqual(xEvent.id, yEvent.id);
  } finally {
    values.byId.set("xy-binding", previous);
  }
});

test("XY binding deletes only an exact-span counterpart", () => {
  const previous = values.byId.get("xy-binding");
  try {
    values.byId.set("xy-binding", true);
    const chart = createChart();
    const xEvent = createEvent(12, 24, 2, 5);
    chart.judgeLineList[0].eventLayers[0].moveXEvents = [xEvent];
    chart.judgeLineList[0].eventLayers[0].moveYEvents = [
      createEvent(1, 2, 2, 5),
      createEvent(3, 4, 6, 8),
    ];
    const session = new EditorSession(chart);
    session.lineIndex = 0;
    session.eventLayer = 0;
    session.focus = "events";
    session.eventSelection = new Set(["moveXEvents:0"]);

    assert.equal(deleteObjects(session), 1);

    assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveXEvents.length, 0);
    assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveYEvents.length, 1);
    assert.equal(
      beatValue(session.chart.judgeLineList[0].eventLayers[0].moveYEvents[0].startTime),
      6,
    );
  } finally {
    values.byId.set("xy-binding", previous);
  }
});

test("XY binding fills the missing counterpart when pasting an event", () => {
  const previous = values.byId.get("xy-binding");
  try {
    values.byId.set("xy-binding", true);
    const chart = createChart();
    chart.judgeLineList[0].eventLayers[0].moveXEvents = [];
    chart.judgeLineList[0].eventLayers[0].moveYEvents = [];
    const session = new EditorSession(chart);
    session.eventClipboard = [{ type: "moveXEvents", event: createEvent(4, 8, 0, 2) }];
    session.eventClipboardLines = [0];
    session.eventClipboardLayers = [0];
    session.eventClipboardPreserveLayers = false;

    assert.equal(pasteObjects(session, 5, { targetLineIndex: 0 }), true);

    assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveXEvents.length, 1);
    assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveYEvents.length, 1);
    assert.equal(
      beatValue(session.chart.judgeLineList[0].eventLayers[0].moveYEvents[0].startTime),
      beatValue(session.chart.judgeLineList[0].eventLayers[0].moveXEvents[0].startTime),
    );
    assert.equal(
      beatValue(session.chart.judgeLineList[0].eventLayers[0].moveYEvents[0].endTime),
      beatValue(session.chart.judgeLineList[0].eventLayers[0].moveXEvents[0].endTime),
    );
  } finally {
    values.byId.set("xy-binding", previous);
  }
});

test("XY binding synchronizes both endpoints when an event field changes", () => {
  const previous = values.byId.get("xy-binding");
  try {
    values.byId.set("xy-binding", true);
    const session = xyBoundEventSession();
    session.eventSelection = new Set(["moveYEvents:0"]);

    transformEvents(session, "change event time", (event) => ({
      ...event,
      startTime: fromNumber(3),
      endTime: fromNumber(8),
    }));

    const xEvent = session.chart.judgeLineList[0].eventLayers[0].moveXEvents[0];
    assert.equal(beatValue(xEvent.startTime), 3);
    assert.equal(beatValue(xEvent.endTime), 8);
  } finally {
    values.byId.set("xy-binding", previous);
  }
});

test("XY binding synchronizes a single endpoint moved by the timeline", () => {
  const previous = values.byId.get("xy-binding");
  try {
    values.byId.set("xy-binding", true);
    const session = xyBoundEventSession();
    session.eventSelection = new Set(["moveXEvents:0"]);

    shiftSelectedEvents(session, "startTime", fromNumber(1), "move event start");

    const yEvent = session.chart.judgeLineList[0].eventLayers[0].moveYEvents[0];
    assert.equal(beatValue(yEvent.startTime), 3);
    assert.equal(beatValue(yEvent.endTime), 6);
  } finally {
    values.byId.set("xy-binding", previous);
  }
});

test("XY binding synchronizes time changes from the event command API", () => {
  const previous = values.byId.get("xy-binding");
  try {
    values.byId.set("xy-binding", true);
    const session = xyBoundEventSession();

    const result = updateEventsAtTarget(session, {
      target: {
        lineIndex: 0,
        layer: 0,
        eventType: "moveXEvents",
        from: { beat: 2, positionX: 0 },
        to: { beat: 6, positionX: 0 },
      },
      payload: { nextStartBeat: 4, nextEndBeat: 9 },
    });

    assert.equal(result.status, "committed");
    const nextXEvent = session.chart.judgeLineList[0].eventLayers[0].moveXEvents[0];
    const yEvent = session.chart.judgeLineList[0].eventLayers[0].moveYEvents[0];
    assert.equal(beatValue(nextXEvent.startTime), 4);
    assert.equal(beatValue(nextXEvent.endTime), 9);
    assert.equal(beatValue(yEvent.startTime), 4);
    assert.equal(beatValue(yEvent.endTime), 9);
  } finally {
    values.byId.set("xy-binding", previous);
  }
});

test("XY binding synchronizes multi-line event edits", () => {
  const previous = values.byId.get("xy-binding");
  try {
    values.byId.set("xy-binding", true);
    const session = xyBoundEventSession();
    session.chart.judgeLineList.push(createChart().judgeLineList[0]);
    session.setMultiLineSelection([0, 1]);
    session.setMultiLineMode("events");
    session.multiEventSelection = new Map([[0, new Set(["moveXEvents:0"])]]);
    session.eventSelection = new Set(["moveXEvents:0"]);

    const result = editCapturedSelection(captureSelection(session), {
      event: (event) => ({ ...event, startTime: fromNumber(4), endTime: fromNumber(9) }),
    });
    commitSelectionEdit(session, result, "change multi-line event time");

    const yEvent = session.chart.judgeLineList[0].eventLayers[0].moveYEvents[0];
    assert.equal(beatValue(yEvent.startTime), 4);
    assert.equal(beatValue(yEvent.endTime), 9);
  } finally {
    values.byId.set("xy-binding", previous);
  }
});
