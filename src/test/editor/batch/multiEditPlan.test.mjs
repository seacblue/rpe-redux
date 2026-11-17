/** Verifies beat bounds and the event field vocabulary used by multi-edit. */
import assert from "node:assert/strict";
import test from "node:test";
import { beatValue, fromNumber } from "../../../core/global/chart/timing/beat.ts";
import { EVENT_BATCH_FIELDS } from "../../../core/edit/multiEdit/planVocabulary.ts";
import { previewMultiEdit } from "../../../core/edit/multiEdit/plan.ts";

test("event multi-edit omits duration and order and lists start before end", () => {
  assert.deepEqual(
    EVENT_BATCH_FIELDS.map(([key]) => key),
    ["both", "start", "end", "easing", "t1", "t2", "line", "linkgroup"],
  );
});

test("startTime bounds accept beat notation and write beat values", () => {
  const first = {
    startTime: [0, 0, 1],
    endTime: [1, 0, 1],
    start: 0,
    end: 1,
    easingType: 1,
  };
  const second = {
    startTime: [1, 0, 1],
    endTime: [2, 0, 1],
    start: 0,
    end: 1,
    easingType: 1,
  };
  const snapshot = {
    chart: {
      judgeLineList: [{ eventLayers: [{ moveXEvents: [first, second] }] }],
    },
    lineIndex: 0,
    eventLayer: 0,
    focus: "events",
    notes: [],
    events: [
      { type: "moveXEvents", index: 0, lineIndex: 0, event: first },
      { type: "moveXEvents", index: 1, lineIndex: 0, event: second },
    ],
  };

  const result = previewMultiEdit(snapshot, "events", {
    field: "t1",
    operation: "To",
    lower: "1:1/2",
    upper: "3:1/2",
    easingType: 1,
    cycle: "1",
    disturbance: "0",
  });

  assert.deepEqual(result.changes[0].after.startTime, fromNumber(2.5));
  assert.deepEqual(result.changes[1].after.startTime, fromNumber(3.5));
  assert.equal(beatValue(result.changes[0].after.startTime), 2.5);
  assert.equal(beatValue(result.changes[1].after.startTime), 3.5);
});

test("event type filter edits only the selected track", () => {
  const moveX = {
    startTime: [0, 0, 1],
    endTime: [1, 0, 1],
    start: 0,
    end: 1,
    easingType: 1,
  };
  const moveY = {
    startTime: [0, 0, 1],
    endTime: [1, 0, 1],
    start: 10,
    end: 11,
    easingType: 1,
  };
  const snapshot = {
    chart: {
      judgeLineList: [{ eventLayers: [{ moveXEvents: [moveX], moveYEvents: [moveY] }] }],
    },
    lineIndex: 0,
    eventLayer: 0,
    focus: "events",
    notes: [],
    events: [
      { type: "moveXEvents", index: 0, lineIndex: 0, event: moveX },
      { type: "moveYEvents", index: 0, lineIndex: 0, event: moveY },
    ],
  };

  const result = previewMultiEdit(snapshot, "events", {
    eventType: "moveXEvents",
    field: "both",
    operation: "By",
    lower: "5",
    upper: "5",
  });

  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].type, "moveXEvents");
  assert.equal(result.changes[0].after.start, 5);
  assert.equal(result.changes[0].after.end, 6);
});
