/**
 * Event-type conversion moves one selected event between numeric tracks: the
 * five ordinary tracks stay on the active base layer, scale X/Y move to the
 * line's extended map, and the event keeps every value.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createLine } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import {
  convertEventType,
  isConvertibleEventType,
} from "../../../core/edit/events/eventTypeConversion.ts";
import { setNoiseLineMode } from "../../../core/global/chart/noise/noiseLine.ts";
import {
  convertibleEventTypes,
  eventTypeOptions,
} from "../../../frontend/screens/editor/inspector/events/eventTypeOptions.ts";
import "../../../core/settings/features/editingSettings.ts";
import { values } from "../../../core/state/values.ts";

const BASE_TYPES = ["moveXEvents", "moveYEvents", "rotateEvents", "alphaEvents", "speedEvents"];

/** An empty line so a test controls every track it reads. */
function emptyLine() {
  const line = createLine("Type");
  line.eventLayers = [{}];
  line.extended = {};
  return line;
}

/** A session whose active layer is `layer`, with no authored events. */
function emptySession(layer = 0) {
  const chart = createChart();
  const line = emptyLine();
  while (line.eventLayers.length <= layer) {
    line.eventLayers.push({});
  }
  chart.judgeLineList = [line];
  const session = new EditorSession(chart);
  session.focus = "events";
  session.eventLayer = layer;
  return session;
}

test("converting X to Y keeps the event and its values on the same layer", () => {
  const session = emptySession();
  const event = createEvent(10, 20, 0, 1);
  event.easingType = 3;
  event.linkgroup = 7;
  session.chart.judgeLineList[0].eventLayers[0].moveXEvents = [event];
  session.eventSelection = new Set(["moveXEvents:0"]);

  assert.equal(
    convertEventType(session, { type: "moveXEvents", index: 0 }, "moveYEvents"),
    "moveYEvents:0",
  );
  const line = session.chart.judgeLineList[0];
  assert.equal(line.eventLayers[0].moveXEvents.length, 0);
  assert.equal(line.eventLayers[0].moveYEvents[0], event);
  assert.deepEqual(
    [line.eventLayers[0].moveYEvents[0].start, line.eventLayers[0].moveYEvents[0].end],
    [10, 20],
  );
  assert.equal(line.eventLayers[0].moveYEvents[0].easingType, 3);
  assert.equal(line.eventLayers[0].moveYEvents[0].linkgroup, 7);
  assert.deepEqual([...session.eventSelection], ["moveYEvents:0"]);
  assert.equal(session.history.undoStack.length, 1);
});

test("scale X lives on the extended map and converts back to the active layer", () => {
  const session = emptySession(2);
  const event = createEvent(0.5, 1.5, 0, 1);
  session.chart.judgeLineList[0].eventLayers[2].moveXEvents = [event];
  session.eventSelection = new Set(["moveXEvents:0"]);

  assert.equal(
    convertEventType(session, { type: "moveXEvents", index: 0 }, "scaleXEvents"),
    "scaleXEvents:0",
  );
  let line = session.chart.judgeLineList[0];
  assert.equal(line.extended.scaleXEvents[0], event);
  assert.equal(line.eventLayers[2].moveXEvents.length, 0);

  assert.equal(
    convertEventType(session, { type: "scaleXEvents", index: 0 }, "moveXEvents"),
    "moveXEvents:0",
  );
  line = session.chart.judgeLineList[0];
  assert.equal(line.eventLayers[2].moveXEvents[0], event);
  assert.equal(line.extended.scaleXEvents.length, 0);
  assert.equal(session.history.undoStack.length, 2);
});

test("the converted event is inserted in beat order on the target track", () => {
  const session = emptySession();
  session.chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(0, 1, 0, 0.5)];
  session.chart.judgeLineList[0].eventLayers[0].moveYEvents = [createEvent(5, 6, 1, 2)];
  session.eventSelection = new Set(["moveXEvents:0"]);

  assert.equal(
    convertEventType(session, { type: "moveXEvents", index: 0 }, "moveYEvents"),
    "moveYEvents:0",
  );
  assert.deepEqual(
    session.chart.judgeLineList[0].eventLayers[0].moveYEvents.map((event) => [
      event.start,
      event.end,
    ]),
    [
      [0, 1],
      [5, 6],
    ],
  );
  assert.deepEqual([...session.eventSelection], ["moveYEvents:0"]);
});

test("an exact-span target event stays beside the converted one", () => {
  const session = emptySession();
  const source = createEvent(10, 20, 0, 1);
  const parallel = createEvent(3, 4, 0, 1);
  session.chart.judgeLineList[0].eventLayers[0].moveXEvents = [source];
  session.chart.judgeLineList[0].eventLayers[0].rotateEvents = [parallel];
  session.eventSelection = new Set(["moveXEvents:0"]);

  assert.equal(
    convertEventType(session, { type: "moveXEvents", index: 0 }, "rotateEvents"),
    "rotateEvents:1",
  );
  const rotate = session.chart.judgeLineList[0].eventLayers[0].rotateEvents;
  assert.equal(rotate.length, 2);
  assert.equal(rotate[0], parallel);
  assert.equal(rotate[1], source);
  assert.deepEqual([...session.eventSelection], ["rotateEvents:1"]);
});

test("a covered span migrates without dropping either event", () => {
  const session = emptySession();
  const source = createEvent(0, 1, 0, 2);
  const existing = createEvent(5, 6, 1, 3);
  session.chart.judgeLineList[0].eventLayers[0].moveXEvents = [source];
  session.chart.judgeLineList[0].eventLayers[0].moveYEvents = [existing];
  session.eventSelection = new Set(["moveXEvents:0"]);

  assert.equal(
    convertEventType(session, { type: "moveXEvents", index: 0 }, "moveYEvents"),
    "moveYEvents:0",
  );
  const line = session.chart.judgeLineList[0];
  assert.equal(line.eventLayers[0].moveXEvents.length, 0);
  assert.deepEqual(line.eventLayers[0].moveYEvents, [source, existing]);
  assert.deepEqual([...session.eventSelection], ["moveYEvents:0"]);
  assert.equal(session.history.undoStack.length, 1);
});

test("non-numeric tracks are not offered and cannot be converted", () => {
  assert.equal(isConvertibleEventType("colorEvents"), false);
  assert.equal(isConvertibleEventType("paintEvents"), false);
  assert.equal(isConvertibleEventType("textEvents"), false);

  const session = emptySession();
  assert.throws(
    () => convertEventType(session, { type: "colorEvents", index: 0 }, "moveXEvents"),
    /cannot be converted/i,
  );
  assert.equal(session.history.undoStack.length, 0);
});

test("a trajectory event migrates without a blocking check", () => {
  const session = emptySession();
  const event = createEvent(0, 1, 0, 1);
  event.trajectory = { version: 1, options: {}, segments: 64 };
  session.chart.judgeLineList[0].eventLayers[0].moveXEvents = [event];
  session.eventSelection = new Set(["moveXEvents:0"]);

  assert.equal(
    convertEventType(session, { type: "moveXEvents", index: 0 }, "moveYEvents"),
    "moveYEvents:0",
  );
  const moved = session.chart.judgeLineList[0].eventLayers[0].moveYEvents[0];
  assert.equal(moved, event);
  assert.ok(moved.trajectory);
});

test("the type menu lists the five ordinary tracks with the extended layer off", () => {
  assert.deepEqual(
    convertibleEventTypes(emptyLine(), 0, {
      eventLayers: false,
      extendedEvents: false,
    }),
    BASE_TYPES,
  );
});

test("enabling the extended layer adds scale X and scale Y", () => {
  assert.deepEqual(
    convertibleEventTypes(emptyLine(), 0, {
      eventLayers: false,
      extendedEvents: true,
    }),
    [...BASE_TYPES, "scaleXEvents", "scaleYEvents"],
  );
});

test("a noise line keeps scale X/Y with the extended layer disabled", () => {
  const line = setNoiseLineMode(emptyLine(), "normal", true);
  assert.deepEqual(
    convertibleEventTypes(line, 0, {
      eventLayers: false,
      extendedEvents: false,
    }),
    ["moveXEvents", "moveYEvents", "rotateEvents", "scaleXEvents", "scaleYEvents"],
  );
});

test("existing extended events keep scale X/Y reachable while the layer is hidden", () => {
  const line = emptyLine();
  line.extended = { scaleXEvents: [createEvent(1, 1, 0, 1)] };
  assert.deepEqual(
    convertibleEventTypes(line, 0, {
      eventLayers: false,
      extendedEvents: false,
    }),
    [...BASE_TYPES, "scaleXEvents", "scaleYEvents"],
  );
});

test("the authored track stays listed when the line's rules hide it", () => {
  const line = setNoiseLineMode(emptyLine(), "normal", true);
  const options = eventTypeOptions(
    line,
    0,
    { eventLayers: false, extendedEvents: false },
    "alphaEvents",
  );
  assert.ok(options.some((option) => option.type === "alphaEvents"));
});

test("XY binding keeps both events when X becomes Y", () => {
  const previous = values.byId.has("xy-binding") ? values.byId.get("xy-binding") : false;
  try {
    values.byId.set("xy-binding", true);
    const session = emptySession();
    const xEvent = createEvent(12, 24, 0, 2);
    const yEvent = createEvent(1, 2, 0, 2);
    session.chart.judgeLineList[0].eventLayers[0].moveXEvents = [xEvent];
    session.chart.judgeLineList[0].eventLayers[0].moveYEvents = [yEvent];
    session.eventSelection = new Set(["moveXEvents:0"]);

    assert.equal(
      convertEventType(session, { type: "moveXEvents", index: 0 }, "moveYEvents"),
      "moveYEvents:1",
    );
    const line = session.chart.judgeLineList[0];
    assert.equal(line.eventLayers[0].moveXEvents.length, 0);
    assert.deepEqual(line.eventLayers[0].moveYEvents, [yEvent, xEvent]);
    assert.deepEqual([...session.eventSelection], ["moveYEvents:1"]);
  } finally {
    values.byId.set("xy-binding", previous);
  }
});

test("one event in a multi-line selection converts and re-keys that line", () => {
  const session = emptySession();
  session.chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(0, 1, 0, 1)];
  session.chart.judgeLineList.push(createLine("Other"));
  session.setMultiLineSelection([0, 1], { persist: false });
  session.setMultiLineMode("events");
  session.multiEventSelection = new Map([[0, new Set(["moveXEvents:0"])]]);
  session.eventSelection = new Set(["moveXEvents:0"]);

  assert.equal(
    convertEventType(session, { lineIndex: 0, type: "moveXEvents", index: 0 }, "rotateEvents"),
    "rotateEvents:0",
  );
  assert.deepEqual([...session.multiEventSelection.get(0)], ["rotateEvents:0"]);
  assert.deepEqual([...session.eventSelection], ["rotateEvents:0"]);
});
