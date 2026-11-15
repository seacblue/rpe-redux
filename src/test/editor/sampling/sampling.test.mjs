/** Workspace sampling axes, guides, snapping, settings migration, and commit rules. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent } from "../../../core/global/chart/chart.ts";
import {
  PREFERENCE_SECTIONS,
  readPreference,
  writePreference,
} from "../../../core/state/preferences.ts";
import {
  applySamplingAnchors,
  DEFAULT_SAMPLING_SETTINGS,
  normalizeSamplingScalar,
  readSamplingSettings,
  samplingAxisForEventType,
  samplingGuideValues,
  samplingRangeOf,
  snapSamplingScalar,
  updateSamplingSettings,
} from "../../../core/edit/sampling/sampling.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import {
  anchorStagePoint,
  buildSamplingGeometry,
  nearestGuideKey,
  samplingHoveredGuideKey,
  sampleSamplingPointer,
  samplingGuideOpacity,
  samplingGuideSegments,
  scalarToStageX,
  viewportOf,
} from "../../../frontend/screens/editor/workspace/stage/sampling/samplingGuides.ts";

/** Settings with snapping and XY binding available but not required by the caller. */
const plainSettings = { ...DEFAULT_SAMPLING_SETTINGS, xyBinding: false };

/** A 1000x800 stage projection used by the scalar and XY mapping tests. */
function projectionWith(overrides = {}) {
  return {
    stageWidth: 1000,
    stageHeight: 800,
    canvasLeft: 0,
    canvasTop: 0,
    centerX: 500,
    centerY: 400,
    scaleX: 1,
    scaleY: 1,
    viewportLeft: 100,
    viewportTop: 100,
    viewportWidth: 800,
    viewportHeight: 600,
    lineX: 500,
    lineY: 400,
    ...overrides,
  };
}

/** A session with one event on the named track. */
function sessionWithEvent(type, event) {
  const chart = createChart();
  const layer = chart.judgeLineList[0].eventLayers[0];
  layer[type] = event ? [event] : [];
  return new EditorSession(chart);
}

/** A session with one X event and one Y event on the first line. */
function sessionWithTracks(xEvent, yEvent) {
  const chart = createChart();
  const layer = chart.judgeLineList[0].eventLayers[0];
  layer.moveXEvents = xEvent ? [xEvent] : [];
  layer.moveYEvents = yEvent ? [yEvent] : [];
  return new EditorSession(chart);
}

/** A target aimed at one event on the first line. */
function targetFor(eventType, event, axis, index = 0) {
  return { lineIndex: 0, eventType, eventIndex: index, eventId: event.id, eventLayer: 0, axis };
}

/** Both anchors for one axis, with optional XY points. */
function anchorsFor(axis, start, end, startPoint, endPoint) {
  return {
    start: { axis, scalar: start, ...(startPoint ? { point: startPoint } : {}) },
    end: { axis, scalar: end, ...(endPoint ? { point: endPoint } : {}) },
  };
}

/** The first event on one track of the session's first line. */
function firstEvent(session, type) {
  return session.chart.judgeLineList[0].eventLayers[0][type][0];
}

test("event tracks map to their workspace sampling axis, including speed", () => {
  assert.equal(samplingAxisForEventType("moveXEvents"), "x");
  assert.equal(samplingAxisForEventType("moveYEvents"), "y");
  assert.equal(samplingAxisForEventType("rotateEvents"), "rotation");
  assert.equal(samplingAxisForEventType("alphaEvents"), "alpha");
  assert.equal(samplingAxisForEventType("speedEvents"), "speed");
  assert.equal(samplingAxisForEventType("colorEvents"), null);
  assert.equal(samplingAxisForEventType("textEvents"), null);
});
test("sampling ranges expose unbounded XY and linear scalar base domains", () => {
  assert.deepEqual(samplingRangeOf("x"), {
    min: Number.NEGATIVE_INFINITY,
    max: Number.POSITIVE_INFINITY,
  });
  assert.deepEqual(samplingRangeOf("y"), {
    min: Number.NEGATIVE_INFINITY,
    max: Number.POSITIVE_INFINITY,
  });
  assert.deepEqual(samplingRangeOf("rotation"), { min: -180, max: 180 });
  assert.deepEqual(samplingRangeOf("alpha"), { min: 0, max: 255 });
  assert.deepEqual(samplingRangeOf("speed"), { min: 0, max: 20 });
});

/** Guide values from `minimum` through `maximum`, stepping by `step`. */
function steppedValues(minimum, maximum, step) {
  const values = [];
  for (let value = minimum; value <= maximum; value = Math.round((value + step) * 100) / 100) {
    values.push(value);
  }
  if (values.at(-1) !== maximum) {
    values.push(maximum);
  }
  return values;
}
test("guide values follow each axis guide step and include both bounded ends", () => {
  const rotation = samplingGuideValues("rotation", DEFAULT_SAMPLING_SETTINGS);
  assert.deepEqual(rotation, steppedValues(-180, 180, 30));
  assert.equal(rotation.length, 13);
  assert.equal(rotation.includes(-180), true);
  assert.equal(rotation.includes(180), true);

  const fineRotation = samplingGuideValues("rotation", {
    ...DEFAULT_SAMPLING_SETTINGS,
    angleGuideStep: 15,
  });
  assert.equal(fineRotation.length, 25);
  assert.deepEqual(fineRotation.slice(0, 4), [-180, -165, -150, -135]);
  assert.equal(fineRotation.at(-1), 180);

  assert.deepEqual(
    samplingGuideValues("alpha", DEFAULT_SAMPLING_SETTINGS),
    steppedValues(0, 255, 20),
  );
  assert.deepEqual(
    samplingGuideValues("alpha", { ...DEFAULT_SAMPLING_SETTINGS, alphaGuideStep: 30 }),
    steppedValues(0, 255, 30),
  );

  const defaultSpeed = samplingGuideValues("speed", DEFAULT_SAMPLING_SETTINGS);
  assert.deepEqual(defaultSpeed, steppedValues(0, 20, 2));
  assert.equal(defaultSpeed.length, 11);
  assert.equal(defaultSpeed[0], 0);
  assert.equal(defaultSpeed.at(-1), 20);

  const unevenSpeed = samplingGuideValues("speed", {
    ...DEFAULT_SAMPLING_SETTINGS,
    speedGuideStep: 3,
  });
  assert.deepEqual(unevenSpeed, steppedValues(0, 20, 3));
  assert.equal(unevenSpeed.at(-1), 20);

  // The guide step clamps to SAMPLING_SPEED_MIN, so 0.1 becomes 0.5.
  const fineSpeed = samplingGuideValues("speed", {
    ...DEFAULT_SAMPLING_SETTINGS,
    speedGuideStep: 0.1,
  });
  assert.equal(fineSpeed.length, 41);
  assert.equal(fineSpeed[1], 0.5);
  assert.equal(fineSpeed.at(-1), 20);

  assert.deepEqual(samplingGuideValues("x", DEFAULT_SAMPLING_SETTINGS), []);
  assert.deepEqual(samplingGuideValues("y", DEFAULT_SAMPLING_SETTINGS), []);
});
test("sampling guides extend beyond the preview and reveal outside pixels near the pointer", () => {
  const projection = {
    stageWidth: 1600,
    stageHeight: 1800,
    canvasLeft: 0,
    canvasTop: 0,
    centerX: 800,
    centerY: 750,
    scaleX: 1,
    scaleY: 1,
    viewportLeft: 125,
    viewportTop: 100,
    viewportWidth: 1350,
    viewportHeight: 900,
    lineX: 800,
    lineY: 550,
  };
  const viewport = viewportOf(projection);
  const geometry = buildSamplingGeometry(projection, "x", DEFAULT_SAMPLING_SETTINGS);
  assert.ok(geometry.vertical.some((line) => line.position < viewport.left));
  assert.ok(geometry.vertical.some((line) => line.position > viewport.right));
  assert.equal(samplingGuideOpacity(800, 550, viewport, null), 1);
  assert.equal(samplingGuideOpacity(800, 1270, viewport, null), 1);
  assert.ok(Math.abs(samplingGuideOpacity(800, 1405, viewport, null) - 0.5) < 1e-9);
  assert.equal(samplingGuideOpacity(800, 1540, viewport, null), 0);
  assert.equal(samplingGuideOpacity(800, 1300, viewport, { x: 800, y: 1300 }), 1);
  assert.ok(Math.abs(samplingGuideOpacity(800, 1600, viewport, { x: 800, y: 1465 }) - 0.5) < 1e-9);
  const segments = samplingGuideSegments(
    800,
    "vertical",
    projection.stageWidth,
    projection.stageHeight,
    viewport,
    null,
  );
  assert.ok(segments.some((segment) => segment.opacity === 1));
  assert.ok(segments.some((segment) => segment.opacity === 0));
});
test("cursor reveal adds to the existing outside fade", () => {
  const projection = {
    stageWidth: 1600,
    stageHeight: 1800,
    canvasLeft: 0,
    canvasTop: 0,
    centerX: 800,
    centerY: 750,
    scaleX: 1,
    scaleY: 1,
    viewportLeft: 125,
    viewportTop: 100,
    viewportWidth: 1350,
    viewportHeight: 900,
    lineX: 800,
    lineY: 550,
  };
  const viewport = viewportOf(projection);

  assert.ok(Math.abs(samplingGuideOpacity(800, 1405, viewport, { x: 800, y: 1270 }) - 1) < 1e-9);
});
test("scalar sampling uses vertical guides across the bounded horizontal range", () => {
  const projection = projectionWith();
  const viewport = viewportOf(projection);
  const geometry = buildSamplingGeometry(projection, "alpha", DEFAULT_SAMPLING_SETTINGS);
  assert.equal(geometry.scalar.minValue, 0);
  assert.equal(geometry.scalar.maxValue, 255);
  assert.equal(geometry.horizontal.length, 0);
  assert.equal(
    geometry.vertical.find((line) => line.value === 0).position,
    projection.viewportLeft,
  );
  assert.equal(
    geometry.vertical.find((line) => line.value === 255).position,
    projection.viewportLeft + projection.viewportWidth,
  );
  const bounds = { left: 0, top: 0 };
  const leftSample = sampleSamplingPointer(
    projection.viewportLeft,
    projection.viewportTop + projection.viewportHeight / 2,
    bounds,
    projection,
    "alpha",
    DEFAULT_SAMPLING_SETTINGS,
  );
  const rightSample = sampleSamplingPointer(
    projection.viewportLeft + projection.viewportWidth,
    projection.viewportTop + projection.viewportHeight / 2,
    bounds,
    projection,
    "alpha",
    DEFAULT_SAMPLING_SETTINGS,
  );
  assert.equal(leftSample.value.scalar, 0);
  assert.equal(rightSample.value.scalar, 255);
  assert.equal(scalarToStageX("alpha", 0, viewport), projection.viewportLeft);
  assert.equal(
    scalarToStageX("alpha", 255, viewport),
    projection.viewportLeft + projection.viewportWidth,
  );
  assert.ok(geometry.vertical.some((line) => line.position < viewport.left));
  assert.ok(geometry.vertical.some((line) => line.position > viewport.right));
  const outsideLeft = sampleSamplingPointer(
    0,
    projection.viewportTop + projection.viewportHeight / 2,
    bounds,
    projection,
    "alpha",
    DEFAULT_SAMPLING_SETTINGS,
  );
  const outsideRight = sampleSamplingPointer(
    projection.stageWidth,
    projection.viewportTop + projection.viewportHeight / 2,
    bounds,
    projection,
    "alpha",
    DEFAULT_SAMPLING_SETTINGS,
  );
  assert.equal(outsideLeft.value.scalar, -32);
  assert.equal(outsideRight.value.scalar, 287);
  assert.ok(Math.abs(scalarToStageX("alpha", -20, viewport) - 37.25490196078431) < 1e-9);
});
test("the nearest guide is the only cursor-highlight candidate", () => {
  const lines = [
    { key: "v:0", value: 0, position: 100, major: true },
    { key: "v:1", value: 1, position: 200, major: false },
    { key: "v:2", value: 2, position: 300, major: false },
  ];

  assert.equal(nearestGuideKey(lines, 207), "v:1");
  assert.deepEqual([nearestGuideKey(lines, 214), nearestGuideKey(lines, 216)], ["v:1", null]);
  assert.equal(nearestGuideKey(lines, 250), null);
  assert.equal(samplingHoveredGuideKey(lines, 207, true), "v:1");
  assert.equal(samplingHoveredGuideKey(lines, 207, false), null);
});

test("XY snapping requires a guide intersection instead of one guide line", () => {
  const projection = projectionWith();
  const bounds = { left: 0, top: 0 };
  const nearXOnly = sampleSamplingPointer(552, 383, bounds, projection, "x", plainSettings);
  assert.equal(nearXOnly.value.scalar, 52);
  assert.equal(nearXOnly.snapped, false);

  const nearIntersection = sampleSamplingPointer(552, 352, bounds, projection, "x", plainSettings);
  assert.equal(nearIntersection.value.scalar, 50);
  assert.deepEqual(nearIntersection.value.point, { x: 50, y: 50 });
  assert.equal(nearIntersection.snapped, true);
});

test("scalar anchors preserve the pointer Y while sampling only the horizontal value", () => {
  const projection = projectionWith({ lineY: 275 });
  const sample = sampleSamplingPointer(
    500,
    245,
    { left: 0, top: 0 },
    projection,
    "alpha",
    plainSettings,
  );
  const point = anchorStagePoint(sample.value, projection);
  assert.equal(sample.stage.y, 245);
  assert.equal(point.y, 245);
});

test("normalization keeps scalar values linear without circular wrapping or clamping", () => {
  assert.equal(normalizeSamplingScalar("rotation", -200), -200);
  assert.equal(normalizeSamplingScalar("rotation", 360), 360);
  assert.equal(normalizeSamplingScalar("rotation", 725), 725);
  assert.equal(normalizeSamplingScalar("alpha", -4), -4);
  assert.equal(normalizeSamplingScalar("alpha", 999), 999);
  assert.equal(normalizeSamplingScalar("alpha", 127.6), 128);
  assert.equal(normalizeSamplingScalar("speed", -1), -1);
  assert.equal(normalizeSamplingScalar("speed", 1.234), 1.23);
  assert.equal(normalizeSamplingScalar("speed", 1.005), 1.01);
  assert.equal(normalizeSamplingScalar("speed", 15), 15);
  assert.equal(normalizeSamplingScalar("speed", 25), 25);
  assert.equal(normalizeSamplingScalar("speed", 20.006), 20.01);
  assert.equal(normalizeSamplingScalar("x", 12.345), 12.35);
  assert.equal(normalizeSamplingScalar("y", -14.567), -14.57);
  assert.equal(normalizeSamplingScalar("x", Number.NaN), 0);
});

test("snapping only applies within the tolerance of a guide", () => {
  const settings = { ...DEFAULT_SAMPLING_SETTINGS, guidesEnabled: true };

  assert.deepEqual(snapSamplingScalar("rotation", 31, settings, 1.5), { value: 30, snapped: true });
  assert.deepEqual(snapSamplingScalar("rotation", 37, settings, 1.5), {
    value: 37,
    snapped: false,
  });
  assert.deepEqual(snapSamplingScalar("rotation", 359, settings, 2), { value: 360, snapped: true });
  assert.deepEqual(snapSamplingScalar("rotation", 360, settings, 0), {
    value: 360,
    snapped: true,
  });
  assert.deepEqual(snapSamplingScalar("rotation", -179, settings, 2), {
    value: -180,
    snapped: true,
  });

  assert.deepEqual(snapSamplingScalar("alpha", 60, settings, 5), { value: 60, snapped: true });
  assert.deepEqual(snapSamplingScalar("alpha", 30, settings, 5), { value: 30, snapped: false });
  assert.deepEqual(snapSamplingScalar("alpha", 255, settings, 0), { value: 255, snapped: true });

  assert.deepEqual(snapSamplingScalar("speed", 1.9, settings, 0.2), { value: 2, snapped: true });
  assert.deepEqual(snapSamplingScalar("speed", 1.5, settings, 0.2), { value: 1.5, snapped: false });
  assert.deepEqual(snapSamplingScalar("speed", 19.9, settings, 0.2), { value: 20, snapped: true });
  assert.deepEqual(snapSamplingScalar("speed", 20, settings, 0), { value: 20, snapped: true });
  assert.deepEqual(snapSamplingScalar("alpha", -15, settings, 5), {
    value: -20,
    snapped: true,
  });

  assert.deepEqual(snapSamplingScalar("x", 47, settings, 5), { value: 47, snapped: false });
  assert.deepEqual(snapSamplingScalar("y", 37, settings, 5), { value: 37, snapped: false });
  assert.deepEqual(snapSamplingScalar("rotation", 31, { ...settings, guidesEnabled: false }, 100), {
    value: 31,
    snapped: false,
  });
  assert.deepEqual(snapSamplingScalar("alpha", 64, { ...settings, guidesEnabled: false }, 100), {
    value: 64,
    snapped: false,
  });
});

test("sampling writes both anchors and the easing type in one commit", () => {
  const event = { ...createEvent(0, 0, 0, 4), easingType: 1 };
  const session = sessionWithEvent("moveXEvents", event);
  const result = applySamplingAnchors(
    session,
    targetFor("moveXEvents", event, "x"),
    anchorsFor("x", 1.234, 9.876),
    4,
    plainSettings,
  );

  assert.equal(result.createdCounterpart, false);
  const next = firstEvent(session, "moveXEvents");
  assert.equal(next.start, 1.23);
  assert.equal(next.end, 9.88);
  assert.equal(next.easingType, 4);
  assert.equal(session.history.undoStack.length, 1);
});

test("a hook event receives the start scalar on both anchors", () => {
  const event = { ...createEvent(0, 0, 0, 4), inst: true };
  const session = sessionWithEvent("moveXEvents", event);
  applySamplingAnchors(
    session,
    targetFor("moveXEvents", event, "x"),
    anchorsFor("x", 3, 9),
    2,
    plainSettings,
  );

  const next = firstEvent(session, "moveXEvents");
  assert.equal(next.start, 3);
  assert.equal(next.end, 3);
});

test("speed sampling keeps both anchors outside its base domain without an XY counterpart", () => {
  const event = createEvent(1, 2, 0, 2);
  const session = sessionWithEvent("speedEvents", event);
  const result = applySamplingAnchors(
    session,
    targetFor("speedEvents", event, "speed"),
    anchorsFor("speed", 1.234, -1),
    1,
    { ...plainSettings, xyBinding: true },
  );

  assert.equal(result.createdCounterpart, false);
  const next = firstEvent(session, "speedEvents");
  assert.equal(next.start, 1.23);
  assert.equal(next.end, -1);
});

test("sampling a read-only chart reports the read-only error", () => {
  const event = createEvent(0, 0, 0, 4);
  const chart = createChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [event];
  const session = new EditorSession(chart, true);

  assert.throws(
    () =>
      applySamplingAnchors(
        session,
        targetFor("moveXEvents", event, "x"),
        anchorsFor("x", 10, 20),
        1,
        plainSettings,
      ),
    /read.?only|只读/i,
  );
  assert.equal(session.history.undoStack.length, 0);
});

test("XY binding updates an existing counterpart with the same span", () => {
  const xEvent = {
    ...createEvent(10, 20, 2, 5),
    linkgroup: 7,
    easingType: 3,
    trajectory: { version: 1, segments: 4 },
    trajectoryAxis: "x",
  };
  const yEvent = { ...createEvent(3, 4, 2, 5), linkgroup: 9 };
  const session = sessionWithTracks(xEvent, yEvent);
  const result = applySamplingAnchors(
    session,
    targetFor("moveXEvents", xEvent, "x"),
    anchorsFor("x", 11, 33, { x: 11, y: 22 }, { x: 33, y: 44 }),
    5,
    { ...plainSettings, xyBinding: true },
    { easingLeft: 0.2, easingRight: 0.8 },
  );

  assert.equal(result.createdCounterpart, false);
  const layer = session.chart.judgeLineList[0].eventLayers[0];
  assert.equal(layer.moveYEvents.length, 1);
  const counterpart = layer.moveYEvents[0];
  assert.equal(counterpart.id, yEvent.id);
  assert.equal(counterpart.start, 22);
  assert.equal(counterpart.end, 44);
  assert.equal(counterpart.easingType, 5);
  assert.equal(counterpart.easingLeft, 0.2);
  assert.equal(counterpart.easingRight, 0.8);
  assert.equal(counterpart.linkgroup, undefined);
  assert.equal(counterpart.trajectory, undefined);
  assert.equal(counterpart.trajectoryAxis, undefined);
  assert.equal(layer.moveXEvents[0].trajectory.version, 1);
});

test("XY binding creates a counterpart only when the span is new", () => {
  const xEvent = createEvent(10, 20, 2, 5);
  const yEvent = createEvent(3, 4, 0, 1);
  const session = sessionWithTracks(xEvent, yEvent);
  const result = applySamplingAnchors(
    session,
    targetFor("moveXEvents", xEvent, "x"),
    anchorsFor("x", 11, 33, { x: 11, y: 22 }, { x: 33, y: 44 }),
    1,
    { ...plainSettings, xyBinding: true },
  );

  assert.equal(result.createdCounterpart, true);
  const layer = session.chart.judgeLineList[0].eventLayers[0];
  assert.equal(layer.moveYEvents.length, 2);
  const created = layer.moveYEvents.find((event) => event.startTime[0] === 2);
  assert.equal(created.start, 22);
  assert.equal(created.end, 44);
  assert.notEqual(created.id, xEvent.id);
});

test("Y sampling creates the missing X counterpart from the sampled X points", () => {
  const yEvent = createEvent(5, 15, 2, 5);
  const session = sessionWithTracks(null, yEvent);
  const result = applySamplingAnchors(
    session,
    targetFor("moveYEvents", yEvent, "y"),
    anchorsFor("y", 22, 44, { x: 11, y: 22 }, { x: 33, y: 44 }),
    1,
    { ...plainSettings, xyBinding: true },
  );

  assert.equal(result.createdCounterpart, true);
  const counterpart = firstEvent(session, "moveXEvents");
  assert.equal(counterpart.start, 11);
  assert.equal(counterpart.end, 33);
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveYEvents[0].start, 22);
});

test("a curve payload writes the preset and the selected sub-range", () => {
  const event = { ...createEvent(0, 0, 0, 2), easingType: 1 };
  const session = sessionWithEvent("moveXEvents", event);
  applySamplingAnchors(
    session,
    targetFor("moveXEvents", event, "x"),
    anchorsFor("x", 0, 100),
    { easingType: 9, easingLeft: 0.25, easingRight: 0.75 },
    plainSettings,
  );

  const next = firstEvent(session, "moveXEvents");
  assert.equal(next.easingType, 9);
  assert.equal(next.easingLeft, 0.25);
  assert.equal(next.easingRight, 0.75);
  assert.equal(session.history.undoStack.length, 1);
});

test("selecting bezier writes valid control points", () => {
  const event = createEvent(0, 0, 0, 2);
  const session = sessionWithEvent("moveXEvents", event);
  applySamplingAnchors(
    session,
    targetFor("moveXEvents", event, "x"),
    anchorsFor("x", 0, 100),
    1,
    plainSettings,
    { bezier: true, bezierPoints: [0.1, 0, 0.9, 1] },
  );

  const next = firstEvent(session, "moveXEvents");
  assert.equal(next.bezier, 1);
  assert.deepEqual(next.bezierPoints, [0.1, 0, 0.9, 1]);
});

test("missing or degenerate bezier points repair while repeated-x curves survive", () => {
  const missing = createEvent(0, 0, 0, 2);
  delete missing.bezierPoints;
  const missingSession = sessionWithEvent("moveXEvents", missing);
  applySamplingAnchors(
    missingSession,
    targetFor("moveXEvents", missing, "x"),
    anchorsFor("x", 0, 100),
    1,
    plainSettings,
    { bezier: 1 },
  );
  assert.deepEqual(firstEvent(missingSession, "moveXEvents").bezierPoints, [0, 0, 1, 1]);

  const degenerate = createEvent(0, 0, 0, 2);
  const degenerateSession = sessionWithEvent("moveXEvents", degenerate);
  applySamplingAnchors(
    degenerateSession,
    targetFor("moveXEvents", degenerate, "x"),
    anchorsFor("x", 0, 100),
    1,
    plainSettings,
    { bezier: 1, bezierPoints: [0, 0, 0, 0] },
  );
  assert.deepEqual(firstEvent(degenerateSession, "moveXEvents").bezierPoints, [0, 0, 1, 1]);

  const repeated = createEvent(0, 0, 0, 2);
  const repeatedSession = sessionWithEvent("moveXEvents", repeated);
  applySamplingAnchors(
    repeatedSession,
    targetFor("moveXEvents", repeated, "x"),
    anchorsFor("x", 0, 100),
    1,
    plainSettings,
    { bezier: 1, bezierPoints: [0.5, 0, 0.5, 1] },
  );
  assert.deepEqual(firstEvent(repeatedSession, "moveXEvents").bezierPoints, [0.5, 0, 0.5, 1]);
});

test("structurally invalid curves are rejected without a commit", () => {
  for (const points of [
    [0, 0, 1],
    [0, 0, 1.5, 1],
    [1, 0, 0, 1],
    [0, 0, Number.NaN, 1],
  ]) {
    const event = createEvent(0, 0, 0, 2);
    const session = sessionWithEvent("moveXEvents", event);
    assert.throws(
      () =>
        applySamplingAnchors(
          session,
          targetFor("moveXEvents", event, "x"),
          anchorsFor("x", 0, 100),
          1,
          plainSettings,
          { bezier: 1, bezierPoints: points },
        ),
      /bezierPoints/i,
    );
    assert.equal(session.history.undoStack.length, 0);
    assert.equal(firstEvent(session, "moveXEvents").start, 0);
  }

  const event = createEvent(0, 0, 0, 2);
  const session = sessionWithEvent("moveXEvents", event);
  assert.throws(
    () =>
      applySamplingAnchors(
        session,
        targetFor("moveXEvents", event, "x"),
        anchorsFor("x", 0, 100),
        1,
        plainSettings,
        { easingLeft: 1.2 },
      ),
    /easingLeft/i,
  );
  assert.throws(
    () =>
      applySamplingAnchors(
        session,
        targetFor("moveXEvents", event, "x"),
        anchorsFor("x", 0, 100),
        1,
        plainSettings,
        { easingLeft: 0.8, easingRight: 0.2 },
      ),
    /easingLeft/i,
  );
  assert.equal(session.history.undoStack.length, 0);
});

test("an invalid preset keeps the event's existing easing index", () => {
  const event = { ...createEvent(0, 0, 0, 2), easingType: 6 };
  const session = sessionWithEvent("moveXEvents", event);
  applySamplingAnchors(
    session,
    targetFor("moveXEvents", event, "x"),
    anchorsFor("x", 0, 100),
    99,
    plainSettings,
  );
  assert.equal(firstEvent(session, "moveXEvents").easingType, 6);
});

test("one sample including the curve is one undo entry", () => {
  const xEvent = createEvent(10, 20, 2, 5);
  const session = sessionWithTracks(xEvent, null);
  applySamplingAnchors(
    session,
    targetFor("moveXEvents", xEvent, "x"),
    anchorsFor("x", 11, 33, { x: 11, y: 22 }, { x: 33, y: 44 }),
    4,
    { ...plainSettings, xyBinding: true },
    { bezier: 1, bezierPoints: [0.25, 0, 0.75, 1] },
  );

  assert.equal(session.history.undoStack.length, 1);
  assert.equal(firstEvent(session, "moveXEvents").start, 11);
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveYEvents.length, 1);

  assert.equal(session.travel("undo"), true);
  const restored = firstEvent(session, "moveXEvents");
  assert.equal(restored.start, 10);
  assert.equal(restored.end, 20);
  assert.equal(restored.bezier, 0);
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveYEvents.length, 0);

  assert.equal(session.travel("redo"), true);
  assert.equal(firstEvent(session, "moveXEvents").start, 11);
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveYEvents.length, 1);
});

test("sampling settings default to one guide density per axis", () => {
  assert.equal(DEFAULT_SAMPLING_SETTINGS.guidesEnabled, true);
  assert.equal(DEFAULT_SAMPLING_SETTINGS.guideStep, 50);
  assert.equal(DEFAULT_SAMPLING_SETTINGS.angleGuideStep, 30);
  assert.equal(DEFAULT_SAMPLING_SETTINGS.alphaGuideStep, 20);
  assert.equal(DEFAULT_SAMPLING_SETTINGS.speedGuideStep, 2);
  assert.equal(DEFAULT_SAMPLING_SETTINGS.xyBinding, true);
  assert.equal(DEFAULT_SAMPLING_SETTINGS.guideOpacity, 50);
});

test("sampler preferences migrate the old grid field names", () => {
  const previous = readPreference(PREFERENCE_SECTIONS.sampler, null);
  try {
    writePreference(PREFERENCE_SECTIONS.sampler, {
      gridEnabled: false,
      gridSize: 120,
      angleGridSize: 20,
    });
    const migrated = readSamplingSettings();
    assert.equal(migrated.guidesEnabled, false);
    assert.equal(migrated.guideStep, 120);
    assert.equal(migrated.angleGuideStep, 20);
    assert.equal(migrated.alphaGuideStep, 20);
    assert.equal(migrated.speedGuideStep, 2);
    assert.equal(migrated.xyBinding, true);
    assert.equal(migrated.guideOpacity, 50);

    writePreference(PREFERENCE_SECTIONS.sampler, {
      gridEnabled: false,
      guidesEnabled: true,
      gridSize: 10,
      guideStep: 75,
      angleGridSize: 10,
      angleGuideStep: 25,
      alphaGuideStep: 35,
      speedGuideStep: 0.5,
      guideOpacity: 75,
    });
    const current = readSamplingSettings();
    assert.equal(current.guidesEnabled, true);
    assert.equal(current.guideStep, 75);
    assert.equal(current.angleGuideStep, 25);
    assert.equal(current.alphaGuideStep, 35);
    assert.equal(current.speedGuideStep, 0.5);
    assert.equal(current.guideOpacity, 75);
  } finally {
    writePreference(PREFERENCE_SECTIONS.sampler, previous);
  }
});

test("settings updates clamp every guide step and persist the new shape", () => {
  const previous = readPreference(PREFERENCE_SECTIONS.sampler, null);
  try {
    const next = updateSamplingSettings({
      guidesEnabled: false,
      guideStep: 5,
      angleGuideStep: 99,
      alphaGuideStep: 0,
      speedGuideStep: 9,
      xyBinding: false,
      guideOpacity: -10,
    });
    assert.equal(next.guidesEnabled, false);
    assert.equal(next.guideStep, 10);
    assert.equal(next.angleGuideStep, 90);
    assert.equal(next.alphaGuideStep, 1);
    assert.equal(next.speedGuideStep, 9);
    assert.equal(next.xyBinding, false);
    assert.equal(next.guideOpacity, 0);
    assert.deepEqual(readPreference(PREFERENCE_SECTIONS.sampler, null), next);
    assert.deepEqual(readSamplingSettings(), next);

    const floor = updateSamplingSettings({
      angleGuideStep: 0,
      alphaGuideStep: 300,
      speedGuideStep: 0,
      guideOpacity: 150,
    });
    assert.equal(floor.angleGuideStep, 5);
    assert.equal(floor.alphaGuideStep, 255);
    assert.equal(floor.speedGuideStep, 0.5);
    assert.equal(floor.guideOpacity, 100);
    assert.deepEqual(readSamplingSettings(), floor);
  } finally {
    writePreference(PREFERENCE_SECTIONS.sampler, previous);
  }
});
