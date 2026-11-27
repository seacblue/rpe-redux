/**
 * A multi-line event marquee selects by beat range, not by what the last frame
 * painted, so a drag that reaches past the viewport keeps the events outside it;
 * the panel geometry that feeds that query keeps one track list per panel.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createLine } from "../../../core/global/chart/chart.ts";
import { beatValue } from "../../../core/global/chart/timing/beat.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { selectEventsInRectangle } from "../../../core/edit/timeline/selection.ts";
import { eventSelectionGeometry } from "../../../frontend/screens/editor/workspace/timeline/selection/rectangleSelection.ts";

const NEAR = createEvent(0, 0, 10, 11);
const FAR = createEvent(1, 1, 40, 41);

/** A two-panel event session whose first line holds one near and one far event. */
function farApartSession() {
  const chart = createChart();
  const line = createLine("line");
  line.eventLayers[0].moveXEvents = [NEAR, FAR];
  chart.judgeLineList = [line, createLine("second")];
  const session = new EditorSession(chart);
  session.multiLineEnabled = true;
  session.multiLineMode = "events";
  session.multiLineIndices = [0, 1];
  return { session, line };
}

/**
 * Panel geometry for the marquee.
 *
 * `painted` lists the bars the last frame drew, which is what the timeline can
 * see on screen; the panel query below always sees the whole track.
 */
function marqueeGeometry(line, painted) {
  const track = () => line.eventLayers[0].moveXEvents.map((item, index) => ({ index, item }));
  return {
    rectangles: painted
      ? [{ x: 0, y: 0, width: 100, height: 10, type: "moveXEvents", index: 0, lineIndex: 0 }]
      : [],
    scroll: 0,
    eventTypes: ["moveXEvents"],
    columnBounds: () => ({ x: 0, width: 100 }),
    eventsInRange: track,
    lines: [
      {
        lineIndex: 0,
        eventTypes: ["moveXEvents"],
        columnBounds: () => ({ x: 0, width: 100 }),
        eventsInRange: track,
      },
    ],
  };
}

test("a marquee reaching past the viewport keeps the off-screen events", () => {
  const { session, line } = farApartSession();

  selectEventsInRectangle(
    session,
    { left: 0, right: 100, bottom: 5, top: 50, append: true, baseEvents: new Map() },
    marqueeGeometry(line, true),
  );

  assert.deepEqual(
    [...(session.multiEventSelection.get(0) ?? [])].sort(),
    ["moveXEvents:0", "moveXEvents:1"],
    "the far event is selected even though only the near bar was painted",
  );
});

test("a marquee that stops at the screen edge still filters by beat", () => {
  const { session, line } = farApartSession();

  selectEventsInRectangle(
    session,
    { left: 0, right: 100, bottom: 5, top: 20, append: true, baseEvents: new Map() },
    marqueeGeometry(line, true),
  );

  assert.deepEqual([...(session.multiEventSelection.get(0) ?? [])], ["moveXEvents:0"]);
});

test("an appended marquee keeps events selected beyond its range", () => {
  const { session, line } = farApartSession();
  session.multiEventSelection = new Map([[0, new Set(["moveXEvents:1"])]]);
  session.eventSelection = new Set(["moveXEvents:1"]);

  selectEventsInRectangle(
    session,
    {
      left: 0,
      right: 100,
      bottom: 5,
      top: 20,
      append: true,
      baseEvents: new Map([[0, new Set(["moveXEvents:1"])]]),
    },
    marqueeGeometry(line, true),
  );

  assert.deepEqual(
    [...(session.multiEventSelection.get(0) ?? [])].sort(),
    ["moveXEvents:0", "moveXEvents:1"],
    "the earlier selection survives the new range",
  );
});

test("a replace marquee selects the full range too", () => {
  const { session, line } = farApartSession();

  selectEventsInRectangle(
    session,
    { left: 0, right: 100, bottom: 5, top: 50 },
    marqueeGeometry(line, true),
  );

  assert.deepEqual([...(session.multiEventSelection.get(0) ?? [])].sort(), [
    "moveXEvents:0",
    "moveXEvents:1",
  ]);
});

/** A timeline surface stand-in exposing only what the marquee geometry reads. */
function fakeSurface(session) {
  const chart = session.chart;
  return {
    getSession: () => session,
    eventTypes: ["moveXEvents"],
    cache: {
      eventEntries: (_chart, items, start, end) =>
        items
          .map((item, index) => ({
            item,
            index,
            start: beatValue(item.startTime),
            end: beatValue(item.endTime),
          }))
          .filter((entry) => entry.end >= start && entry.start <= end),
    },
    gestures: { eventRects: [] },
    viewport: {
      eventBarWidth: 1,
      eventColumnBounds: (channel) => ({ x: channel * 50, width: 50 }),
      eventInset: () => 0,
      eventTypesForLine: (lineIndex) =>
        lineIndex === 0 ? ["moveXEvents"] : ["moveXEvents", "alphaEvents"],
      gridCount: 11,
      multiLineViewportOffset: () => 0,
      panelIndex: (lineIndex) => lineIndex,
      panelStride: () => 220,
      panelWidth: () => 200,
      visiblePanelRange: () => [0, 1],
    },
    chart,
  };
}

test("the marquee geometry describes each visible panel on its own", () => {
  const { session } = farApartSession();
  session.chart.judgeLineList[1].eventLayers[0].alphaEvents = [createEvent(0, 0, 12, 13)];

  const geometry = eventSelectionGeometry(fakeSurface(session), 1000);
  const lines = geometry.lines ?? [];

  assert.deepEqual(
    lines.map((entry) => entry.lineIndex),
    [0, 1],
    "one entry per visible panel",
  );
  assert.equal(lines[1].columnBounds(0).x, 220, "the second panel starts one stride over");
  assert.equal(lines[0].columnBounds(0).width, 200, "one track fills the panel");
  assert.equal(lines[1].columnBounds(0).width, 100, "two tracks split the panel");
  assert.deepEqual(
    lines[1].eventsInRange("alphaEvents", 0, 100).map((entry) => entry.index),
    [0],
    "each panel queries its own line's tracks",
  );
  assert.deepEqual(
    lines[0].eventsInRange("moveXEvents", 0, 100).map((entry) => entry.index),
    [0, 1],
    "the panel query covers the whole beat range",
  );
});
