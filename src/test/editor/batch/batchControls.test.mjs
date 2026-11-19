/** Verifies each batch-control drag feedback stays on the active control ball. */
import assert from "node:assert/strict";
import test from "node:test";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { createChart, createNote } from "../../../core/global/chart/chart.ts";
import { BatchControls } from "../../../frontend/screens/editor/workspace/stage/batchControls/batchControls.ts";

/** Build the smallest controller state needed to exercise one pointer update. */
function controllerForDrag() {
  const session = new EditorSession(createChart());
  const button = {
    style: { transform: "" },
    parentElement: null,
    hasPointerCapture: () => false,
    animate(frames) {
      this.animationFrames = frames;
    },
  };
  const group = {
    style: { transform: "" },
    getAnimations: () => [],
    animate(frames) {
      this.animationFrames = frames;
    },
  };
  button.parentElement = group;
  const controller = Object.create(BatchControls.prototype);
  controller.anchorMode = 0;
  controller.getSession = () => session;
  controller.groups = new Map([["events", { signature: "" }]]);
  controller.state = { hints: { set() {} } };
  controller.timeline = {
    notesCanvas: { clientWidth: 100, clientHeight: 100 },
    eventsCanvas: { clientWidth: 100, clientHeight: 100 },
    gestures: { scaleAxis: null, scaleAxisLine: null },
    viewport: {
      tempo: {
        beat: (seconds) => seconds,
        seconds: (beat) => (Array.isArray(beat) ? beat[0] + beat[1] / beat[2] : beat),
      },
      origin: 0,
      scale: 1,
      scaleForArea: () => 1,
      judgementOffset: 42,
      division: 1,
      panelWidth: () => 100,
      noteInset: () => 0,
      factorForLine: () => 1,
      snapX: false,
      gridCount: 11,
    },
    setPreview() {},
    changed() {},
  };
  controller.active = {
    session,
    snapshot: {
      chart: session.chart,
      lineIndex: 0,
      eventLayer: 0,
      focus: "events",
      notes: [],
      events: [],
    },
    kind: "event-move",
    button,
    group,
    label: "event move",
    area: "events",
    lineIndex: 0,
    bounds: { left: 0, right: 100, width: 100 },
    signature: "",
    pointerId: 1,
    start: { x: 10, y: 10 },
    point: { x: 30, y: 40 },
    canvas: { clientWidth: 100, clientHeight: 100 },
    unit: 1,
    factor: 1,
    startBeat: 0,
    startX: 10,
  };
  return { controller, button, group };
}

test("batch drag translates only the active control ball immediately", () => {
  const { controller, button, group } = controllerForDrag();

  controller.update();

  assert.equal(button.style.transform, "translate(20px, 30px)");
  assert.equal(group.style.transform, "");
});

test("batch drag returns only the active control ball to the dock", () => {
  const { controller, button, group } = controllerForDrag();
  controller.active.canvas.getBoundingClientRect = () => ({ width: 100, height: 100 });

  controller.returnBall(controller.active, false);

  assert.equal(button.animationFrames.length, 61);
  assert.equal(group.animationFrames, undefined);
});

test("multi-line note drags convert time with the active area scale", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes = [createNote(1, 0, 0)];
  const session = new EditorSession(chart);
  const button = { style: { transform: "" }, parentElement: null };
  const group = { style: { transform: "" }, getAnimations: () => [] };
  button.parentElement = group;
  const controller = Object.create(BatchControls.prototype);
  controller.anchorMode = 0;
  controller.state = { hints: { set() {} } };
  controller.timeline = {
    notesCanvas: { clientWidth: 100, clientHeight: 100 },
    eventsCanvas: { clientWidth: 100, clientHeight: 100 },
    gestures: { scaleAxis: null, scaleAxisLine: null },
    viewport: {
      tempo: {
        beat: (seconds) => seconds,
        seconds: (beat) => (Array.isArray(beat) ? beat[0] + beat[1] / beat[2] : beat),
      },
      origin: 0,
      scale: 1,
      scaleForArea: () => 2,
      judgementOffset: 42,
      division: 1,
      panelWidth: () => 100,
      noteInset: () => 0,
      factorForLine: () => 1,
      snapX: false,
      gridCount: 11,
    },
    setPreview() {},
    changed() {},
  };
  controller.active = {
    session,
    snapshot: {
      chart: session.chart,
      lineIndex: 0,
      eventLayer: 0,
      focus: "notes",
      notes: [{ lineIndex: 0, index: 0, note: session.chart.judgeLineList[0].notes[0] }],
      events: [],
    },
    kind: "note-move",
    button,
    group,
    label: "note move",
    area: "notes",
    lineIndex: 0,
    bounds: { left: 0, right: 100, width: 100 },
    signature: "",
    pointerId: 1,
    start: { x: 10, y: 10 },
    point: { x: 10, y: 20 },
    canvas: { clientWidth: 100, clientHeight: 100 },
    unit: 1,
    factor: 1,
    startBeat: 0,
    startX: 10,
  };

  controller.update();

  assert.deepEqual(controller.active.result.chart.judgeLineList[0].notes[0].startTime, [-5, 0, 1]);
});

test("batch preview rebuilds coalesce within one display frame", () => {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  let scheduled;
  let updates = 0;
  const controller = Object.create(BatchControls.prototype);
  controller.updateFrame = null;
  controller.active = {};
  controller.update = () => {
    updates += 1;
  };
  globalThis.requestAnimationFrame = (callback) => {
    scheduled = callback;
    return 17;
  };
  globalThis.cancelAnimationFrame = () => {};
  try {
    controller.scheduleUpdate();
    controller.scheduleUpdate();
    assert.equal(updates, 0);
    assert.equal(controller.updateFrame, 17);
    scheduled(0);
    assert.equal(updates, 1);
    assert.equal(controller.updateFrame, null);
  } finally {
    globalThis.requestAnimationFrame = previousRequest;
    globalThis.cancelAnimationFrame = previousCancel;
  }
});

/** A controller docked on two selected notes, with a mutable viewport. */
function dockedController() {
  const chart = createChart();
  chart.judgeLineList[0].notes = [createNote(1, 0, 0), createNote(1, 4, 0)];
  const session = new EditorSession(chart);
  session.selection = new Set([0, 1]);
  const canvas = {
    clientWidth: 200,
    clientHeight: 200,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 200 }),
  };
  const viewport = {
    tempo: {
      beat: (seconds) => seconds,
      seconds: (beat) => (Array.isArray(beat) ? beat[0] + beat[1] / beat[2] : beat),
    },
    origin: 0,
    scale: 1,
    scaleForArea: () => 1,
    judgementOffset: 42,
    division: 4,
    panelWidth: () => 200,
    panelIndex: () => 0,
    panelStride: () => 200,
    multiLineViewportOffset: () => 0,
    factorForLine: () => 1,
    snapX: false,
    gridCount: 11,
  };
  const controller = Object.create(BatchControls.prototype);
  controller.anchorMode = 0;
  controller.getSession = () => session;
  controller.enabled = () => true;
  controller.active = null;
  controller.groups = new Map([["notes", { signature: "" }]]);
  controller.state = {
    hints: { set() {} },
    presentations: { get: () => ({}), update: () => {} },
  };
  controller.timeline = {
    notesCanvas: canvas,
    eventsCanvas: canvas,
    gestures: { cursor: { x: 100, y: 100 }, eventCursor: null },
    viewport,
    setPreview() {},
    changed() {},
    cancelPlacement() {},
  };
  controller.stage = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  return { controller, viewport, group: controller.groups.get("notes") };
}

test("a docked control ball follows the timeline scroll", () => {
  const { controller, viewport, group } = dockedController();

  controller.sync();
  assert.equal(group.left, "160px");
  assert.equal(group.top, "90px");

  // Scrolling forward moves the selection down the canvas by the scrolled time.
  viewport.origin = 10;
  controller.sync();

  assert.equal(group.top, "100px", "the ball follows the scrolled selection");
  assert.equal(group.left, "160px", "scrolling time does not move the dock sideways");
});

test("a docked control ball follows a multi-line horizontal pan", () => {
  const { controller, viewport, group } = dockedController();

  controller.sync();
  assert.equal(group.left, "160px");

  // Panning the panels left moves their content left by the same distance.
  viewport.multiLineViewportOffset = () => 30;
  controller.sync();

  assert.equal(group.left, "130px", "the ball follows the panned panel");
  assert.equal(group.top, "90px", "panning does not move the dock vertically");
});

test("a docked control ball follows a vertical zoom", () => {
  const { controller, viewport, group } = dockedController();
  // Dock closer to the judgement line so the anchored time stays on screen when
  // the field doubles its scale.
  controller.timeline.gestures.cursor = { x: 100, y: 128 };

  controller.sync();
  assert.equal(group.top, "118px");

  // Zooming in doubles the distance from the judgement line to the dock.
  viewport.scaleForArea = () => 2;
  controller.sync();

  assert.equal(group.top, "58px", "the ball keeps the same time under it when zooming");
});
