/** Verifies batch-control drag feedback stays on the whole control group. */
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
  };
  const group = {
    style: { transform: "" },
    getAnimations: () => [],
  };
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

test("batch drag translates the whole control group immediately", () => {
  const { controller, button, group } = controllerForDrag();

  controller.update();

  assert.equal(group.style.transform, "translate(20px, 30px)");
  assert.equal(button.style.transform, "");
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
