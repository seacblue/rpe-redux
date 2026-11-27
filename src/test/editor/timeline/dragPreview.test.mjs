/** Direct note drags use relative grid steps without absolute lane snapping. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createNote } from "../../../core/global/chart/chart.ts";
import { beatValue } from "../../../core/global/chart/timing/beat.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { moveTimelineNote } from "../../../core/edit/timeline/dragPreview.ts";

function drag(currentX, currentY = 100) {
  return {
    kind: "move",
    anchor: 0,
    lineIndex: 0,
    start: { x: 0, y: 100 },
    current: { x: currentX, y: currentY },
    scrolled: false,
  };
}

function context() {
  return {
    tempo: {
      beat: (seconds) => seconds,
      seconds: (beat) => (Array.isArray(beat) ? beat[0] + beat[1] / beat[2] : beat),
    },
    origin: 0,
    scale: 1,
    division: 4,
    panelWidth: 1350,
    inset: 0,
    gridCount: 11,
    snapX: true,
    snapY: true,
    factor: 1,
  };
}

test("a snapped drag moves by grid spacing from the original note position", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes = [createNote(1, 0, 37)];
  const session = new EditorSession(chart);
  const moved = moveTimelineNote(
    session.chart.judgeLineList[0].notes[0],
    drag(100),
    session,
    context(),
  );

  assert.equal(moved.positionX, 172);
});

test("horizontal and vertical snap switches affect independent axes", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes = [createNote(1, 0, 37)];
  const session = new EditorSession(chart);

  const rawTime = moveTimelineNote(
    session.chart.judgeLineList[0].notes[0],
    drag(100, 98.7),
    session,
    { ...context(), snapY: false },
  );
  assert.equal(rawTime.positionX, 172);
  assert.ok(Math.abs(beatValue(rawTime.startTime) - 1.3) < 0.001);

  const rawX = moveTimelineNote(session.chart.judgeLineList[0].notes[0], drag(100, 98.7), session, {
    ...context(),
    snapX: false,
  });
  assert.equal(rawX.positionX, 137);
  assert.equal(beatValue(rawX.startTime), 1.25);
});

test("playback origin changes cannot pull an active note drag", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes = [createNote(1, 100, 37)];
  const session = new EditorSession(chart);
  const moved = moveTimelineNote(
    chart.judgeLineList[0].notes[0],
    { ...drag(100), originSeconds: 0 },
    session,
    { ...context(), origin: 200 },
  );

  assert.equal(beatValue(moved.startTime), 100);
});

test("an active drag still applies explicit timeline auto-scroll", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes = [createNote(1, 100, 37)];
  const session = new EditorSession(chart);
  const moved = moveTimelineNote(
    chart.judgeLineList[0].notes[0],
    { ...drag(100), originSeconds: 0, scrollSeconds: 12 },
    session,
    { ...context(), origin: 200 },
  );

  assert.equal(beatValue(moved.startTime), 112);
});

test("a Z click moves the Hold edge without crossing the drag threshold", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes = [createNote(2, 2, 0, 4)];
  const session = new EditorSession(chart);
  const moved = moveTimelineNote(
    session.chart.judgeLineList[0].notes[0],
    {
      kind: "startTime",
      prekey: true,
      anchor: 0,
      lineIndex: 0,
      start: { x: 0, y: 100 },
      current: { x: 0, y: 100 },
      currentSeconds: 3,
      startFactor: 1,
      scrolled: false,
    },
    session,
    context(),
  );

  assert.equal(beatValue(moved.startTime), 3);
  assert.equal(beatValue(moved.endTime), 4);
});

test("a Z Hold head follows the pointer row instead of its travel distance", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes = [createNote(2, 2, 0, 4)];
  const session = new EditorSession(chart);
  const moved = moveTimelineNote(
    session.chart.judgeLineList[0].notes[0],
    {
      kind: "startTime",
      anchor: 0,
      lineIndex: 0,
      start: { x: 0, y: 100 },
      current: { x: 0, y: 40 },
      currentSeconds: 3,
      startFactor: 1,
      scrolled: false,
    },
    session,
    context(),
  );

  assert.equal(beatValue(moved.startTime), 3);
  assert.equal(beatValue(moved.endTime), 4);
});

test("a Z Hold edge drag also moves the Hold on the X axis", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes = [createNote(2, 2, 0, 4)];
  const session = new EditorSession(chart);
  const moved = moveTimelineNote(
    session.chart.judgeLineList[0].notes[0],
    {
      kind: "startTime",
      prekey: true,
      anchor: 0,
      lineIndex: 0,
      start: { x: 100, y: 100 },
      current: { x: 200, y: 100 },
      currentSeconds: 2,
      startFactor: 1,
      scrolled: false,
    },
    session,
    context(),
  );

  assert.notEqual(moved.positionX, 0);
  assert.equal(beatValue(moved.startTime), 2);
});
