/** Event-bar edge gesture zones and drag anchors. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent } from "../../../core/global/chart/chart.ts";
import { beatValue } from "../../../core/global/chart/timing/beat.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import {
  eventEdgeAt,
  eventEdgeDragFor,
  eventEdgePressDrag,
} from "../../../frontend/screens/editor/workspace/timeline/events/eventEdgeDrag.ts";
import { eventEdgePointerDelta } from "../../../core/edit/timeline/dragPreview.ts";

const rect = { x: 0, y: 100, width: 20, height: 40, index: 0, type: "moveXEvents" };

function sessionWithEvent() {
  const chart = createChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(0, 0, 2, 4)];
  return new EditorSession(chart);
}

test("the top and bottom edge zones map to the matching event edge", () => {
  assert.equal(eventEdgeAt(rect, { x: 0, y: 100 }), "endTime");
  assert.equal(eventEdgeAt(rect, { x: 0, y: 140 }), "startTime");
  assert.equal(eventEdgeAt(rect, { x: 0, y: 120 }), null);
});

test("a Z press trims the single selected event from any pointer row", () => {
  const session = sessionWithEvent();
  session.eventSelection = new Set(["moveXEvents:0"]);
  const timeline = {
    getSession: () => session,
    viewport: { tempo: { seconds: () => 0 }, origin: 0, factorForLine: () => 1 },
  };
  const press = { button: 0, pointerId: 11, ctrlKey: false };

  const head = eventEdgePressDrag(timeline, press, { x: 240, y: 20 }, undefined, false, true);
  assert.ok(head);
  assert.equal(head.kind, "startTime");
  assert.equal(head.prekey, true);
  assert.equal(beatValue(head.anchor), 2);

  const tail = eventEdgePressDrag(
    timeline,
    { ...press, button: 2 },
    { x: 240, y: 20 },
    undefined,
    false,
    true,
  );
  assert.ok(tail);
  assert.equal(tail.kind, "endTime");
  assert.equal(tail.prekey, true);
  assert.equal(beatValue(tail.anchor), 4);
});

test("Ctrl + right keeps the bar tail gesture without the prekey commit", () => {
  const session = sessionWithEvent();
  const timeline = {
    getSession: () => session,
    viewport: { tempo: { seconds: () => 0 }, origin: 0, factorForLine: () => 1 },
  };

  const drag = eventEdgePressDrag(
    timeline,
    { button: 2, pointerId: 12, ctrlKey: true },
    { x: 0, y: 20 },
    rect,
    false,
    false,
  );
  assert.ok(drag);
  assert.equal(drag.kind, "endTime");
  assert.ok(!drag.prekey);
  assert.ok(session.eventSelection.has("moveXEvents:0"));
});

test("a Z press without a single selected event still needs a bar", () => {
  const session = sessionWithEvent();
  const timeline = {
    getSession: () => session,
    viewport: { tempo: { seconds: () => 0 }, origin: 0, factorForLine: () => 1 },
  };
  const press = { button: 0, pointerId: 11, ctrlKey: false };

  assert.equal(
    eventEdgePressDrag(timeline, press, { x: 240, y: 20 }, undefined, false, true),
    null,
  );
});

test("a selected event edge drag does not need a hit rectangle", () => {
  const session = sessionWithEvent();
  const timeline = {
    getSession: () => session,
    viewport: { tempo: { seconds: () => 0 }, origin: 0, factorForLine: () => 1 },
  };

  const drag = eventEdgeDragFor(
    timeline,
    { type: "moveXEvents", index: 0, lineIndex: 0 },
    { x: 240, y: 20 },
    "startTime",
    9,
  );
  assert.ok(drag);
  assert.equal(drag.kind, "startTime");
  assert.equal(beatValue(drag.anchor), 2);
  assert.equal(drag.start.x, 240);
});

test("an edge drag anchors on the edge being moved", () => {
  const session = sessionWithEvent();
  const timeline = {
    getSession: () => session,
    viewport: { tempo: { seconds: () => 0 }, origin: 0, factorForLine: () => 1 },
  };

  const head = eventEdgeDragFor(timeline, rect, { x: 0, y: 140 }, "startTime", 7);
  assert.ok(head);
  assert.equal(head.kind, "startTime");
  assert.equal(beatValue(head.anchor), 2);
  assert.equal(head.pointerId, 7);

  const tail = eventEdgeDragFor(timeline, rect, { x: 0, y: 100 }, "endTime", 8);
  assert.ok(tail);
  assert.equal(tail.kind, "endTime");
  assert.equal(beatValue(tail.anchor), 4);
});

test("an edge drag follows the pointer row instead of its travel distance", () => {
  const context = {
    tempo: {
      beat: (seconds) => seconds,
      seconds: (beat) => beat,
    },
    origin: 0,
    scale: 1,
    division: 4,
  };
  const drag = {
    kind: "startTime",
    anchor: [4, 0, 1],
    startFactor: 1,
    currentSeconds: 6,
    start: { x: 0, y: 0 },
    current: { x: 0, y: 0 },
  };

  assert.equal(beatValue(eventEdgePointerDelta(drag, context, 1)), 2);
});
