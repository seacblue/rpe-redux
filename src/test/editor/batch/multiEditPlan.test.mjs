/** Verifies beat bounds and the event field vocabulary used by multi-edit. */
import assert from "node:assert/strict";
import test from "node:test";
import { beatValue, fromNumber } from "../../../core/global/chart/timing/beat.ts";
import { HOOK_TAIL_FIELD } from "../../../core/global/chart/chart.ts";
import {
  EVENT_BATCH_FIELDS,
  noteBatchFields,
  BATCH_OPERATIONS,
} from "../../../core/edit/multiEdit/planVocabulary.ts";
import { previewMultiEdit } from "../../../core/edit/multiEdit/plan.ts";
import { registerDeferredCatalogs } from "../../../i18n/deferred.ts";
import { getLanguage, setLanguage, t } from "../../../i18n/index.ts";
import { noteFields } from "../../../core/global/chart/noteFields.ts";

test("event multi-edit omits duration and order and lists start before end", () => {
  assert.deepEqual(
    EVENT_BATCH_FIELDS.map(([key]) => key),
    ["both", "start", "end", "red", "green", "blue", "easing", "t1", "t2", "line", "linkgroup"],
  );
});

test("batch labels resolve after the editor catalog is registered", () => {
  const previous = getLanguage();
  registerDeferredCatalogs();
  try {
    setLanguage("zh");
    const field = noteBatchFields().find(([key]) => key === "x");
    const operation = BATCH_OPERATIONS.find(([key]) => key === "By");
    assert.equal(field?.[1], "editor.commands.multiEdit.channel.x");
    assert.equal(operation?.[1], "editor.commands.multiEdit.operation.by");
    assert.equal(t(field?.[1]), "X，横坐标");
    assert.equal(t(operation?.[1]), "By，增减");
  } finally {
    setLanguage(previous);
  }
});

test("note hand is a native batch field with categorical To semantics", () => {
  noteFields.register({
    id: "hand",
    field: "hand",
    label: "Hand",
    kind: "select",
    options: [
      ["", "Unmarked"],
      ["left", "Left"],
      ["right", "Right"],
    ],
  });
  try {
    assert.ok(noteBatchFields().some(([key]) => key === "hand"));
    const note = {
      type: 1,
      startTime: [0, 0, 1],
      endTime: [0, 0, 1],
      positionX: 0,
    };
    const snapshot = {
      chart: { judgeLineList: [{ notes: [note], numOfNotes: 1 }] },
      lineIndex: 0,
      eventLayer: 0,
      focus: "notes",
      notes: [{ index: 0, lineIndex: 0, note }],
      events: [],
    };
    const result = previewMultiEdit(snapshot, "notes", {
      field: "hand",
      operation: "By",
      lower: "left",
      upper: "right",
    });
    assert.equal(result.changes[0].after.hand, "left");
  } finally {
    noteFields.unregister("hand");
  }
});

test("numeric contributed note fields keep the standard batch operations", () => {
  noteFields.register({
    id: "test-number",
    field: "testNumber",
    label: "Test number",
    kind: "number",
  });
  try {
    const note = {
      type: 1,
      startTime: [0, 0, 1],
      endTime: [0, 0, 1],
      positionX: 0,
      testNumber: 3,
    };
    const result = previewMultiEdit(
      {
        chart: { judgeLineList: [{ notes: [note], numOfNotes: 1 }] },
        lineIndex: 0,
        eventLayer: 0,
        focus: "notes",
        notes: [{ index: 0, lineIndex: 0, note }],
        events: [],
      },
      "notes",
      { field: "testNumber", operation: "By", lower: "2", upper: "2" },
    );
    assert.equal(result.changes[0].after.testNumber, 5);
  } finally {
    noteFields.unregister("test-number");
  }
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

test("event type filter edits every selected track", () => {
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
    eventTypes: ["moveXEvents", "moveYEvents"],
    field: "both",
    operation: "By",
    lower: "5",
    upper: "5",
  });

  assert.equal(result.changes.length, 2);
  assert.equal(result.changes[0].type, "moveXEvents");
  assert.equal(result.changes[0].after.start, 5);
  assert.equal(result.changes[0].after.end, 6);
  assert.equal(result.changes[1].type, "moveYEvents");
  assert.equal(result.changes[1].after.start, 15);
  assert.equal(result.changes[1].after.end, 16);
});

test("event type filter rejects mixed value families", () => {
  const event = {
    startTime: [0, 0, 1],
    endTime: [1, 0, 1],
    start: [10, 20, 30],
    end: [40, 50, 60],
    easingType: 1,
  };
  assert.throws(
    () =>
      previewMultiEdit(
        {
          chart: {
            judgeLineList: [{ eventLayers: [{ moveXEvents: [event], colorEvents: [event] }] }],
          },
          lineIndex: 0,
          eventLayer: 0,
          focus: "events",
          notes: [],
          events: [{ type: "moveXEvents", index: 0, lineIndex: 0, event }],
        },
        "events",
        {
          eventTypes: ["moveXEvents", "colorEvents"],
          field: "both",
          operation: "By",
          lower: "1",
          upper: "1",
        },
      ),
    /same value type|同一种值类型/u,
  );
});

test("RGB event channels update both colour endpoints", () => {
  const event = {
    startTime: [0, 0, 1],
    endTime: [1, 0, 1],
    start: [10, 20, 30],
    end: [40, 50, 60],
    easingType: 1,
  };
  const result = previewMultiEdit(
    {
      chart: { judgeLineList: [{ eventLayers: [{ colorEvents: [event] }] }] },
      lineIndex: 0,
      eventLayer: 0,
      focus: "events",
      notes: [],
      events: [{ type: "colorEvents", index: 0, lineIndex: 0, event }],
    },
    "events",
    {
      eventTypes: ["colorEvents"],
      field: "red",
      operation: "To",
      lower: "255",
      upper: "255",
    },
  );
  assert.deepEqual(result.changes[0].after.start, [255, 20, 30]);
  assert.deepEqual(result.changes[0].after.end, [255, 50, 60]);
});

test("a batch edit keeps a hooked event's pair pinned and caches a new tail", () => {
  const hooked = {
    startTime: [0, 0, 1],
    endTime: [1, 0, 1],
    start: 10,
    end: 10,
    easingType: 1,
    inst: 1,
    [HOOK_TAIL_FIELD]: 20,
  };
  const snapshot = {
    chart: { judgeLineList: [{ eventLayers: [{ moveXEvents: [hooked] }] }] },
    lineIndex: 0,
    eventLayer: 0,
    focus: "events",
    notes: [],
    events: [{ type: "moveXEvents", index: 0, lineIndex: 0, event: hooked }],
  };

  // A tail edit replaces the cache so the unhook restores what the batch wrote.
  const tailEdit = previewMultiEdit(snapshot, "events", {
    field: "end",
    operation: "To",
    lower: "40",
    upper: "40",
  });
  assert.equal(tailEdit.changes[0].after.end, 10, "the rendered pair stays pinned");
  assert.equal(tailEdit.changes[0].after[HOOK_TAIL_FIELD], 40);

  // A head edit leaves the cached tail alone, matching an inspector edit.
  const headEdit = previewMultiEdit(snapshot, "events", {
    field: "start",
    operation: "To",
    lower: "15",
    upper: "15",
  });
  assert.equal(headEdit.changes[0].after.start, 15);
  assert.equal(headEdit.changes[0].after.end, 15);
  assert.equal(headEdit.changes[0].after[HOOK_TAIL_FIELD], 20);
});
