/** Verifies the event clone planner, its duplicate target sequence, and drafts. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createLine } from "../../../core/global/chart/chart.ts";
import { beatValue } from "../../../core/global/chart/timing/beat.ts";
import {
  cloneChannelsFor,
  defaultCloneParameters,
  MultiEditParameters,
} from "../../../core/edit/multiEdit/parameters.ts";
import { previewEventClone } from "../../../core/edit/multiEdit/clone.ts";
import { parseLineSelectionInput } from "../../../core/edit/state/lineSelectionInput.ts";
import { resolveLineSequence } from "../../../core/edit/state/lineSelectionTokens.ts";

/** A chart with three empty move-X tracks so clone writes are easy to count. */
function cloneChart() {
  const chart = createChart();
  chart.judgeLineList = [createLine("L0"), createLine("L1"), createLine("L2")];
  for (const line of chart.judgeLineList) {
    line.eventLayers[0].moveXEvents = [];
  }
  return chart;
}

/** Capture one move-X event from a chosen line. */
function cloneSnapshot(chart, lineIndex = 0) {
  const event = chart.judgeLineList[lineIndex].eventLayers[0].moveXEvents[0];
  return {
    chart,
    lineIndex,
    eventLayer: 0,
    focus: "events",
    notes: [],
    events: event ? [{ type: "moveXEvents", index: 0, lineIndex, event }] : [],
  };
}

/** Clone parameters with the common duplicate-target fixture. */
function cloneParameters(overrides = {}) {
  return {
    ...defaultCloneParameters(),
    targets: "1 1 2",
    increment: "4",
    ...overrides,
  };
}

/** Small storage seam shared with the parameter-model tests. */
function storage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    read: () => value,
  };
}

test("clone target resolution keeps written order and repeated lines", () => {
  const available = [0, 1, 2, 3];
  const parsed = parseLineSelectionInput("1:3 3 0", available, []);

  assert.ok(parsed);
  assert.deepEqual(resolveLineSequence(parsed.tokens, available), [1, 2, 3, 3, 0]);
  assert.deepEqual(parsed.lines, [1, 2, 3, 0], "line selection itself stays a union");
});

test("a repeated target line receives copies with successive sequence offsets", () => {
  const chart = cloneChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(10, 20, 0, 1)];
  const snapshot = cloneSnapshot(chart);

  const preview = previewEventClone(snapshot, cloneParameters({ retainSource: true }), 4);

  assert.deepEqual(preview.targets, [1, 1, 2]);
  assert.equal(preview.sourceCount, 1);
  assert.equal(preview.result.changes.length, 3);
  assert.deepEqual(
    preview.result.changes.map((change) => change.lineIndex),
    [1, 1, 2],
  );
  assert.deepEqual(
    preview.result.changes.map((change) => beatValue(change.after.startTime)),
    [0, 1, 2],
  );
  assert.equal(preview.result.chart.judgeLineList[1].eventLayers[0].moveXEvents.length, 2);
  assert.equal(preview.result.chart.judgeLineList[2].eventLayers[0].moveXEvents.length, 1);
});

test("one channel distribution adds to both cloned values", () => {
  const chart = cloneChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(10, 20, 0, 1)];
  const snapshot = cloneSnapshot(chart);
  const defaults = defaultCloneParameters();

  const preview = previewEventClone(
    snapshot,
    cloneParameters({
      retainSource: true,
      increment: "0",
      channels: {
        ...defaults.channels,
        moveXEvents: {
          lower: "0",
          upper: "10",
          easingType: 1,
          disturbance: "0",
          cycle: "1",
        },
      },
    }),
    4,
  );

  assert.deepEqual(
    preview.result.changes.map((change) => change.after.start),
    [10, 15, 20],
  );
  assert.deepEqual(
    preview.result.changes.map((change) => change.after.end),
    [20, 25, 30],
  );
});

test("cycle multipliers accept comma-separated values", () => {
  const chart = cloneChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(10, 20, 0, 1)];
  const snapshot = cloneSnapshot(chart);
  const defaults = defaultCloneParameters();

  const preview = previewEventClone(
    snapshot,
    cloneParameters({
      retainSource: true,
      increment: "0",
      channels: {
        ...defaults.channels,
        moveXEvents: {
          lower: "0",
          upper: "10",
          easingType: 1,
          disturbance: "0",
          cycle: "1,-1,1",
        },
      },
    }),
    4,
  );

  assert.deepEqual(
    preview.result.changes.map((change) => change.after.start),
    [10, 5, 20],
  );
  assert.deepEqual(
    preview.result.changes.map((change) => change.after.end),
    [20, 15, 30],
  );
});

test("clone channels follow the selected event types", () => {
  assert.deepEqual(cloneChannelsFor(["moveXEvents", "speedEvents"]), [
    "moveXEvents",
    "speedEvents",
  ]);
  assert.deepEqual(cloneChannelsFor(["paintEvents", "colorEvents"]), []);
  assert.deepEqual(cloneChannelsFor(["scaleYEvents", "rotateEvents"]), [
    "rotateEvents",
    "scaleYEvents",
  ]);
});

test("speed and scale channels distribute their values too", () => {
  /** Base speed lives on the event layer; both scale tracks live on `extended`. */
  const readTrack = (line, type) =>
    type === "speedEvents" ? line.eventLayers[0][type] : line.extended[type];
  const writeTrack = (line, type, events) => {
    if (type === "speedEvents") {
      line.eventLayers[0][type] = events;
    } else {
      line.extended[type] = events;
    }
  };

  for (const type of ["speedEvents", "scaleXEvents", "scaleYEvents"]) {
    const chart = cloneChart();
    writeTrack(chart.judgeLineList[0], type, [createEvent(10, 20, 0, 1)]);
    writeTrack(chart.judgeLineList[1], type, []);
    const event = readTrack(chart.judgeLineList[0], type)[0];
    const snapshot = {
      chart,
      lineIndex: 0,
      eventLayer: 0,
      focus: "events",
      notes: [],
      events: [{ type, index: 0, lineIndex: 0, event }],
    };
    const defaults = defaultCloneParameters();
    const preview = previewEventClone(
      snapshot,
      {
        ...defaults,
        targets: "1",
        increment: "0",
        retainSource: true,
        channels: {
          ...defaults.channels,
          [type]: {
            lower: "5",
            upper: "5",
            easingType: 1,
            disturbance: "0",
            cycle: "1",
          },
        },
      },
      4,
    );

    assert.equal(preview.result.changes.length, 1, type);
    assert.equal(preview.result.changes[0].after.start, 15, type);
    assert.equal(preview.result.changes[0].after.end, 25, type);
    assert.equal(readTrack(preview.result.chart.judgeLineList[1], type).length, 1, type);
  }
});

test("clone removal drops the source unless keep-source is on", () => {
  const chart = cloneChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(10, 20, 0, 1)];
  const snapshot = cloneSnapshot(chart);

  const kept = previewEventClone(snapshot, cloneParameters({ retainSource: true }), 4);
  assert.equal(kept.result.chart.judgeLineList[0].eventLayers[0].moveXEvents.length, 1);

  const dropped = previewEventClone(snapshot, cloneParameters({ retainSource: false }), 4);
  assert.equal(dropped.result.chart.judgeLineList[0].eventLayers[0].moveXEvents.length, 0);
  assert.equal(dropped.result.chart.judgeLineList[1].eventLayers[0].moveXEvents.length, 2);
});

test("a target sequence may repeat the source line after removal", () => {
  const chart = cloneChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(10, 20, 0, 1)];
  const snapshot = cloneSnapshot(chart);

  const preview = previewEventClone(
    snapshot,
    cloneParameters({ targets: "0 0", increment: "0", retainSource: false }),
    4,
  );

  const line = preview.result.chart.judgeLineList[0].eventLayers[0].moveXEvents;
  assert.equal(line.length, 2);
  assert.deepEqual(
    line.map((event) => event.start),
    [10, 10],
  );
});

test("clone reports when a target line is also a source line", () => {
  const chart = cloneChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(10, 20, 0, 1)];
  const snapshot = cloneSnapshot(chart);

  const overlapping = previewEventClone(
    snapshot,
    cloneParameters({ targets: "0 1", retainSource: true }),
    4,
  );
  assert.equal(overlapping.overlapsSource, true);

  const separate = previewEventClone(
    snapshot,
    cloneParameters({ targets: "1 2", retainSource: true }),
    4,
  );
  assert.equal(separate.overlapsSource, false);
});

test("clone selects the new copies per target line", () => {
  const chart = cloneChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(10, 20, 0, 1)];
  const snapshot = cloneSnapshot(chart);

  const preview = previewEventClone(snapshot, cloneParameters({ retainSource: true }), 4);

  assert.deepEqual(
    [...preview.result.multiEventSelection.get(1)],
    ["moveXEvents:0", "moveXEvents:1"],
  );
  assert.deepEqual([...preview.result.multiEventSelection.get(2)], ["moveXEvents:0"]);
});

test("clone copies every selected event to every target line", () => {
  const chart = cloneChart();
  const first = createEvent(1, 2, 0, 1);
  const second = createEvent(3, 4, 0, 1);
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [first];
  chart.judgeLineList[1].eventLayers[0].moveXEvents = [second];
  const snapshot = {
    chart,
    lineIndex: 0,
    eventLayer: 0,
    focus: "events",
    notes: [],
    events: [
      { type: "moveXEvents", index: 0, lineIndex: 0, event: first },
      { type: "moveXEvents", index: 0, lineIndex: 1, event: second },
    ],
  };

  const preview = previewEventClone(
    snapshot,
    cloneParameters({ targets: "2", increment: "0", retainSource: true }),
    4,
  );

  assert.equal(preview.sourceCount, 2);
  assert.equal(preview.result.changes.length, 2);
  assert.equal(preview.result.chart.judgeLineList[2].eventLayers[0].moveXEvents.length, 2);
});

test("clone rejects an empty selection, an empty target list, and virtual noise events", () => {
  const chart = cloneChart();
  const empty = {
    chart,
    lineIndex: 0,
    eventLayer: 0,
    focus: "events",
    notes: [],
    events: [],
  };
  assert.throws(() => previewEventClone(empty, cloneParameters(), 4), /Select at least one event/);

  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(10, 20, 0, 1)];
  const snapshot = cloneSnapshot(chart);
  assert.throws(
    () => previewEventClone(snapshot, cloneParameters({ targets: "" }), 4),
    /target line/i,
  );

  const noise = {
    ...snapshot,
    events: snapshot.events.map((entry) => ({ ...entry, type: "noiseActiveEvents" })),
  };
  assert.throws(() => previewEventClone(noise, cloneParameters(), 4), /Noise activation/);
});

test("clone refuses a plan above the copy limit", () => {
  const chart = cloneChart();
  const event = createEvent(10, 20, 0, 1);
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [event];
  const events = Array.from({ length: 1001 }, (unused, index) => ({
    type: "moveXEvents",
    index,
    lineIndex: 0,
    event,
  }));
  const snapshot = {
    chart,
    lineIndex: 0,
    eventLayer: 0,
    focus: "events",
    notes: [],
    events,
  };
  const targets = Array.from({ length: 101 }, () => "1").join(" ");

  assert.throws(
    () => previewEventClone(snapshot, cloneParameters({ targets }), 4),
    /reduce the target lines/,
  );
});

test("clone drafts remember keep-source and keep a separate history", () => {
  const saved = storage();
  const parameters = new MultiEditParameters(saved);
  const draft = {
    ...defaultCloneParameters("0"),
    targets: "1 1",
    retainSource: true,
  };
  parameters.updateClone(draft);

  const reopened = new MultiEditParameters(saved);
  assert.equal(reopened.readClone().targets, "1 1");
  assert.equal(reopened.readClone().retainSource, true);
  assert.deepEqual(reopened.history, { notes: [], events: [] });

  assert.equal(parameters.rememberClone(draft), 0);
  const repeated = { ...draft, increment: "2" };
  assert.equal(parameters.rememberClone(repeated), 1);
  assert.equal(parameters.rememberClone(draft), 1);
  assert.deepEqual(
    parameters.cloneHistory.map((entry) => entry.increment),
    ["2", "0"],
  );

  parameters.clearHistory();
  assert.deepEqual(parameters.cloneHistory, []);
});

test("clone channel drafts keep the separate distribution fields", () => {
  const saved = storage();
  const parameters = new MultiEditParameters(saved);
  const base = defaultCloneParameters("0");
  parameters.updateClone({
    ...base,
    channels: {
      ...base.channels,
      moveXEvents: {
        lower: "1+1",
        upper: "10",
        easingType: 5,
        disturbance: "0.5",
        cycle: "1,-1",
      },
    },
  });

  const reopened = new MultiEditParameters(saved);
  assert.deepEqual(reopened.readClone().channels.moveXEvents, {
    lower: "1+1",
    upper: "10",
    easingType: 5,
    disturbance: "0.5",
    cycle: "1,-1",
  });
});

test("an empty stored clone target falls back to the active line", () => {
  const parameters = new MultiEditParameters(storage());
  assert.equal(parameters.readClone("3").targets, "3");
  parameters.updateClone({ ...defaultCloneParameters(), targets: "" });
  assert.equal(parameters.readClone("4").targets, "4");
});
