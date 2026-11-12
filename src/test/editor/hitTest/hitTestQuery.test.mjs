/** Verifies pure temporal object lookup without a mounted timeline or preview surface. */
import assert from "node:assert/strict";
import test from "node:test";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import { queryChartAtTime } from "../../../core/edit/hitTest/query.ts";
import { createHitTestTimeQuery } from "../../../frontend/screens/editor/workspace/runtime/bindings/hitTestBindings.ts";

function chartFixture() {
  return {
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    judgeLineList: [
      {
        id: "line-1",
        bpmfactor: 1,
        notes: [
          {
            id: "tap-1",
            type: 1,
            startTime: [1, 0, 1],
            endTime: [1, 0, 1],
          },
          {
            id: "hold-1",
            type: 2,
            startTime: [1, 0, 1],
            endTime: [3, 0, 1],
          },
        ],
        eventLayers: [
          {
            moveXEvents: [
              {
                id: "move-1",
                startTime: [0, 0, 1],
                endTime: [2, 0, 1],
                start: 0,
                end: 1,
              },
            ],
          },
        ],
        extended: {
          scaleXEvents: [
            {
              id: "scale-1",
              startTime: [1, 0, 1],
              endTime: [2, 0, 1],
              start: 1,
              end: 2,
            },
          ],
        },
        _reduxNoiseLine: {
          version: 2,
          invert: false,
          area: {
            bottomLeft: { x: -0.5, y: -0.5 },
            topRight: { x: 0.5, y: 0.5 },
            appearTime: [0, 0, 1],
            disappearTime: [4, 0, 1],
            activeIntervals: [{ startTime: [1, 0, 1], endTime: [2, 0, 1] }],
          },
        },
      },
    ],
  };
}

test("queryChartAtTime resolves seconds and returns active notes, lines, and events", () => {
  const chart = chartFixture();
  const query = queryChartAtTime({
    chart,
    tempo: new TempoMap(chart.BPMList),
    request: {
      surface: "timeline",
      time: { seconds: 0.5 },
      lineIndex: 0,
      eventLayer: 0,
      coordinateSpace: "chart-time",
    },
  });

  assert.deepEqual(
    query.hits.map(({ kind, objectId, lineIndex, noteIndex, eventType, eventIndex }) => ({
      kind,
      objectId,
      lineIndex,
      ...(noteIndex === undefined ? {} : { noteIndex }),
      ...(eventType === undefined ? {} : { eventType, eventIndex }),
    })),
    [
      { kind: "note", objectId: "tap-1", lineIndex: 0, noteIndex: 0 },
      { kind: "note", objectId: "hold-1", lineIndex: 0, noteIndex: 1 },
      { kind: "judgeLine", objectId: "line-1", lineIndex: 0 },
      { kind: "event", objectId: "move-1", lineIndex: 0, eventType: "moveXEvents", eventIndex: 0 },
      {
        kind: "event",
        objectId: "scale-1",
        lineIndex: 0,
        eventType: "scaleXEvents",
        eventIndex: 0,
      },
      {
        kind: "event",
        objectId: "line:0:event:noiseActiveEvents:0",
        lineIndex: 0,
        eventType: "noiseActiveEvents",
        eventIndex: 0,
      },
    ],
  );
  assert.equal(query.hits[0].lineId, "line-1");
  assert.equal(query.hits[0].noteType, 1);
  assert.deepEqual(query.hits[1].time, { seconds: 0.5, beat: [1, 0, 1] });
  assert.equal(query.hits[3].eventLayer, 0);
  assert.equal(query.hits[3].eventValue, 0.5);
  assert.equal(query.hits[3].easingType, 1);
  assert.equal(query.hits[4].eventLayer, "extended");
  assert.equal(query.totalHits, 6);
  assert.equal(query.truncated, false);
  assert.equal(query.ordering, "lineIndex,notes,judgeLine,eventTrack,eventIndex");
});

test("queryChartAtTime can restrict preview results to one line and one kind", () => {
  const chart = chartFixture();
  const query = queryChartAtTime({
    chart,
    tempo: new TempoMap(chart.BPMList),
    request: {
      surface: "preview",
      time: { beat: [2, 0, 1] },
      lineId: "line-1",
      include: ["note"],
    },
  });

  assert.deepEqual(
    query.hits.map((item) => item.objectId),
    ["hold-1"],
  );
  assert.deepEqual(query.hits[0].startTime, [1, 0, 1]);
  assert.deepEqual(query.hits[0].endTime, [3, 0, 1]);
});

test("queryChartAtTime includes synthetic noise activation events", () => {
  const chart = chartFixture();
  const query = queryChartAtTime({
    chart,
    tempo: new TempoMap(chart.BPMList),
    request: {
      surface: "timeline",
      time: { beat: [1, 0, 1] },
      lineIndex: 0,
      eventLayer: 2,
      coordinateSpace: "chart-time",
    },
  });

  const noise = query.hits.find((item) => item.eventType === "noiseActiveEvents");
  assert.deepEqual(noise && { eventLayer: noise.eventLayer, eventIndex: noise.eventIndex }, {
    eventLayer: 2,
    eventIndex: 0,
  });
});

test("queryChartAtTime applies event filters and reports bounded results", () => {
  const chart = chartFixture();
  const query = queryChartAtTime({
    chart,
    tempo: new TempoMap(chart.BPMList),
    request: {
      surface: "preview",
      time: { beat: [1, 0, 1] },
      eventLayer: 0,
      include: ["event"],
      eventTypes: ["moveXEvents", "noiseActiveEvents"],
      limit: 1,
    },
  });

  assert.deepEqual(
    query.hits.map((item) => item.eventType),
    ["moveXEvents"],
  );
  assert.equal(query.totalHits, 2);
  assert.equal(query.truncated, true);
  assert.equal(query.ordering, "lineIndex,notes,judgeLine,eventTrack,eventIndex");
});

test("the mounted time-query adapter does not change editor interaction state", () => {
  const chart = chartFixture();
  const state = Object.freeze({
    selection: ["note-previously-selected"],
    focus: "notes",
    playbackHead: 12.5,
    scroll: Object.freeze({ notes: 240, events: 180 }),
    viewport: Object.freeze({ origin: 8, scale: 500 }),
    history: Object.freeze({ undo: 3, redo: 0 }),
  });
  const before = structuredClone(state);
  const session = {
    chart,
    get selection() {
      return state.selection;
    },
    get focus() {
      return state.focus;
    },
    get playbackHead() {
      return state.playbackHead;
    },
    get scroll() {
      return state.scroll;
    },
    get viewport() {
      return state.viewport;
    },
    get history() {
      return state.history;
    },
    select() {
      throw new Error("time queries must not select");
    },
    focusEditor() {
      throw new Error("time queries must not focus");
    },
    seek() {
      throw new Error("time queries must not seek");
    },
    scrollTo() {
      throw new Error("time queries must not scroll");
    },
    setViewport() {
      throw new Error("time queries must not change viewport");
    },
    commit() {
      throw new Error("time queries must not write history");
    },
  };
  const queryAt = createHitTestTimeQuery({
    preview: { chart },
    timeline: {
      getSession: () => session,
      viewport: {
        get tempo() {
          throw new Error("temporal queries must not read the viewport tempo");
        },
      },
      gestures: { layer: 0 },
    },
  });

  const results = queryAt({
    surface: "timeline",
    time: { seconds: 0.5 },
    lineIndex: 0,
    eventLayer: 0,
    coordinateSpace: "chart-time",
  });

  assert.equal(results.hits.length > 0, true);
  assert.equal(typeof results.chartFingerprint, "string");
  assert.equal(results.generation, 1);
  assert.deepEqual(state, before);

  assert.throws(
    () =>
      queryAt({
        surface: "preview",
        time: { seconds: 0.5 },
        include: ["event"],
      }),
    /explicit event layer/,
  );
});
