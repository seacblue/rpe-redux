/** Guards the replace-marquee path against redundant session notifications. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createLine } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import {
  selectEventsInRectangle,
  selectNotesInRectangle,
} from "../../../core/edit/timeline/selection.ts";
import { beatValue } from "../../../core/global/chart/timing/beat.ts";

function rectangle() {
  return { left: -10, right: 10, bottom: 0, top: 0.5 };
}

function indexFor(notes) {
  return {
    notes,
    index: {
      query: (bottom, top) =>
        notes
          .map((item, index) => ({
            item,
            index,
            start: beatValue(item.startTime),
            end: beatValue(item.endTime),
          }))
          .filter((entry) => entry.end >= bottom && entry.start <= top),
    },
  };
}

test("replace marquee does not notify when the membership is unchanged", () => {
  const chart = createChart();
  const line = createLine("line");
  line.notes = [
    { type: 1, positionX: 0, startTime: [0, 0, 1], endTime: [0, 0, 1], above: 1, size: 1 },
    { type: 1, positionX: 20, startTime: [1, 0, 1], endTime: [1, 0, 1], above: 1, size: 1 },
  ];
  chart.judgeLineList = [line];
  const session = new EditorSession(chart);
  let notifications = 0;
  session.addEventListener("change", () => {
    notifications += 1;
  });
  const first = selectNotesInRectangle(
    session,
    rectangle(),
    () => indexFor(line.notes),
    () => 0,
  );
  const second = selectNotesInRectangle(
    session,
    rectangle(),
    () => indexFor(line.notes),
    () => 0,
  );
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.matched, true);
  assert.equal(notifications, 1);
  assert.deepEqual([...session.selection], [0]);
});

test("selection notifications are coalesced until the gesture ends", () => {
  const chart = createChart();
  const line = createLine("line");
  line.notes = [
    { type: 1, positionX: 0, startTime: [0, 0, 1], endTime: [0, 0, 1], above: 1, size: 1 },
  ];
  chart.judgeLineList = [line];
  const session = new EditorSession(chart);
  let notifications = 0;
  session.addEventListener("change", () => {
    notifications += 1;
  });
  session.beginSelectionNotificationBatch();
  selectNotesInRectangle(
    session,
    rectangle(),
    () => indexFor(line.notes),
    () => 0,
  );
  assert.equal(notifications, 0);
  session.endSelectionNotificationBatch();
  assert.equal(notifications, 1);
});

test("multi-line replace marquee only queries the visible panel lines", () => {
  const chart = createChart();
  const lines = [0, 1, 2].map(() => createLine("line"));
  lines.forEach((line) => {
    line.notes = [
      { type: 1, positionX: 0, startTime: [0, 0, 1], endTime: [0, 0, 1], above: 1, size: 1 },
    ];
  });
  chart.judgeLineList = lines;
  const session = new EditorSession(chart);
  session.multiLineEnabled = true;
  session.multiLineMode = "notes";
  session.multiLineIndices = [0, 1, 2];
  const queried = [];
  selectNotesInRectangle(
    session,
    { ...rectangle(), lineIndices: [1] },
    (lineIndex) => {
      queried.push(lineIndex);
      return indexFor(lines[lineIndex].notes);
    },
    () => 0,
  );
  assert.deepEqual(queried, [1]);
  assert.deepEqual([...session.multiLineSelection.keys()], [1]);
});

test("replace event marquee remembers its last hit", () => {
  const chart = createChart();
  const line = createLine("line");
  line.eventLayers[0].moveXEvents = [createEvent(0, 1, 0, 1), createEvent(2, 3, 1, 2)];
  chart.judgeLineList = [line];
  const session = new EditorSession(chart);
  const result = selectEventsInRectangle(
    session,
    { left: 0, right: 100, bottom: 0, top: 3 },
    {
      rectangles: [],
      scroll: 0,
      eventTypes: ["moveXEvents"],
      columnBounds: () => ({ x: 0, width: 100 }),
      eventsInRange: () => [
        { index: 0, item: line.eventLayers[0].moveXEvents[0] },
        { index: 1, item: line.eventLayers[0].moveXEvents[1] },
      ],
    },
  );
  assert.equal(result.changed, true);
  assert.deepEqual(session.eventSelectionAnchor, { lineIndex: 0, key: "moveXEvents:1" });
});

test("reverse event marquee remembers the leftmost hit", () => {
  const chart = createChart();
  const line = createLine("line");
  line.eventLayers[0].moveXEvents = [createEvent(0, 1, 0, 1)];
  line.eventLayers[0].moveYEvents = [createEvent(2, 3, 0, 1)];
  chart.judgeLineList = [line];
  const session = new EditorSession(chart);
  selectEventsInRectangle(
    session,
    {
      left: 0,
      right: 100,
      bottom: 0,
      top: 3,
      selectionDirection: "reverse",
    },
    {
      rectangles: [],
      scroll: 0,
      eventTypes: ["moveXEvents", "moveYEvents"],
      columnBounds: (channel) => ({ x: channel * 20, width: 10 }),
      eventsInRange: (type) => [{ index: 0, item: line.eventLayers[0][type][0] }],
    },
  );
  assert.deepEqual(session.eventSelectionAnchor, { lineIndex: 0, key: "moveXEvents:0" });
});
