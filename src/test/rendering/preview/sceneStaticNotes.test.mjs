/**
 * Verifies zero-speed scene sampling: visible-time ordering, Hold cap hiding,
 * and the line-motion trail that keeps zero-length Hold bodies continuous.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
} from "../../../core/global/chart/chart.ts";
import { SceneRuntime } from "../../../core/global/chart/runtime/scene.ts";
import { NoteVisibilityDirectory } from "../../../core/global/chart/runtime/noteVisibility.ts";
import { fromNumber } from "../../../core/global/chart/timing/beat.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";

test("static notes are queried by visible time and keep author order", () => {
  const chart = createChart();
  const line = chart.judgeLineList[0];
  const future = createNote(1, 20, 0);
  const active = createNote(2, 9, 0, 11);
  const expired = createNote(2, 0, 0, 1);
  const nearFuture = createNote(1, 12, 0);
  future.speed = 0;
  future.visibleTime = 1;
  active.speed = 0;
  nearFuture.speed = 0;
  nearFuture.visibleTime = 2;
  expired.speed = 0;
  line.notes = [future, active, expired, nearFuture];

  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const seconds = tempo.seconds(10) + 0.1;
  const state = scene.sample(seconds)[0];
  const visible = scene.lines[0].visibleNotes(seconds, state, 1000);

  assert.deepEqual(
    visible.map((entry) => entry.noteIndex),
    [1, 3],
    "only the visible static notes are returned, in their authored order",
  );
});

test("a line without motion or speed events exposes the static-state fast path", () => {
  const chart = createChart();
  chart.judgeLineList[0].eventLayers = [{}];
  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);

  assert.equal(scene.lines[0].staticState, true);
  assert.equal(scene.allStatesStatic, true);
  assert.deepEqual(scene.sample(0)[0], scene.sample(10)[0]);
});

test("note-only controls keep the line state static during playback", () => {
  const chart = createChart();
  chart.judgeLineList[0].eventLayers = [{}];
  chart.judgeLineList[0].posControl = [
    { x: 0, y: 1 },
    { x: 100, y: 0.5 },
  ];
  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);

  assert.equal(scene.lines[0].staticState, true);
  const first = scene.sampleInto(0, []);
  const second = scene.sampleInto(10, []);
  assert.strictEqual(second[0], first[0]);
});

test("repeated samplers do not reapply a parent transform", () => {
  const chart = createChart();
  const parent = chart.judgeLineList[0];
  parent.eventLayers[0].moveXEvents = [createEvent(100, 0, 0, 10)];
  const child = createLine("Child");
  child.father = 0;
  chart.judgeLineList.push(child);

  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const seconds = tempo.seconds(5);
  const first = scene.sampler(seconds)(1);
  const repeated = scene.sampler(seconds)(1);

  assert.deepEqual(repeated, first);
});

test("parent sampling reuses static local state across playback times", () => {
  const chart = createChart();
  chart.judgeLineList[0].eventLayers = [{}];
  const child = createLine("Child");
  child.father = 0;
  child.eventLayers = [{}];
  chart.judgeLineList.push(child);
  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const parent = scene.lines[0];
  const originalState = parent.state.bind(parent);
  let stateCalls = 0;
  parent.state = (...args) => {
    stateCalls += 1;
    return originalState(...args);
  };

  const first = scene.sampleInto(0, []);
  const second = scene.sampleInto(1, first);
  const expected = scene.sampler(1)(1);
  assert.equal(stateCalls, 1);
  assert.equal(scene.allStatesStatic, true);
  assert.deepEqual(second[1], expected);
});

test("topological parent sampling matches the defensive sampler", () => {
  const chart = createChart();
  chart.judgeLineList = Array.from({ length: 32 }, (_, index) => {
    const line = createLine(`Parent-${index}`);
    line.eventLayers[0] = {};
    if (index > 0) {
      line.father = Math.floor(index / 2);
    }
    if (index % 5 === 0) {
      line.eventLayers[0].moveXEvents = [createEvent(index + 1, 0, 0, 8)];
      line.eventLayers[0].rotateEvents = [createEvent(index * 2, 0, 0, 8)];
    }
    return line;
  });
  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);

  for (const seconds of [0, 0.25, 1, 2.5, 5]) {
    const actual = scene.sampleInto(seconds, []);
    const sample = scene.sampler(seconds);
    const expected = actual.map((_, index) => sample(index));
    assert.deepEqual(actual, expected, `parent state mismatch at ${seconds}s`);
  }
});

test("visible-note queries can split Holds without a second scan", () => {
  const chart = createChart();
  const line = chart.judgeLineList[0];
  line.notes = [createNote(1, 0, 0), createNote(2, 0, 0, 1)];

  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const notes = [];
  const holds = [];
  const state = scene.sample(0)[0];
  scene.lines[0].visibleNotes(0, state, 1000, notes, holds);

  assert.deepEqual(
    notes.map((entry) => entry.noteIndex),
    [0],
  );
  assert.deepEqual(
    holds.map((entry) => entry.noteIndex),
    [1],
  );
});

test("ordinary notes keep their base state on the simple note fast path", () => {
  const chart = createChart();
  const note = createNote(1, 0, 120);
  note.speed = 0.75;
  note.size = 0.8;
  note.alpha = 128;
  chart.judgeLineList[0].notes = [note];

  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const entry = scene.lines[0].notes[0];
  const sampled = scene.lines[0].noteState(entry, scene.sample(0)[0], 0);

  assert.deepEqual(sampled, {
    x: 120,
    y: 0,
    tail: 0,
    size: 0.8,
    alpha: 128 / 255,
    skew: 0,
    showHead: true,
  });
});

test("yControl lines use the time index instead of scanning every note", () => {
  const chart = createChart();
  const line = chart.judgeLineList[0];
  line.yControl = [
    { x: 0, y: 1 },
    { x: 1, y: 0.5 },
  ];
  const future = createNote(1, 20, 0);
  const active = createNote(2, 9, 0, 11);
  const expired = createNote(2, 0, 0, 1);
  const nearFuture = createNote(1, 12, 0);
  future.visibleTime = 1;
  nearFuture.visibleTime = 2;
  line.notes = [future, active, expired, nearFuture];

  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const seconds = tempo.seconds(10) + 0.1;
  const state = scene.sample(seconds)[0];
  const visible = scene.lines[0].visibleNotes(seconds, state, 1000);

  assert.deepEqual(
    visible.map((entry) => entry.noteIndex),
    [1, 3],
    "yControl does not turn the time broad phase back into a full scan",
  );
});

test("a zero-length Hold hides its head cap while active", () => {
  const chart = createChart();
  const line = chart.judgeLineList[0];
  const hold = createNote(2, 5, 0, 5);
  hold.speed = 0;
  line.notes = [hold];

  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const start = tempo.seconds(5);
  const state = scene.sample(start + 0.01)[0];
  const entry = { note: hold, noteIndex: 0, start, end: start, floor: 0, tail: 0 };
  const sampled = scene.lines[0].noteState(entry, state, start + 0.01);

  assert.ok(Math.abs(sampled.tail - sampled.y) < 1e-9);
  assert.equal(sampled.showHead, false, "only the tail cap is painted");
});

test("an active zero-length Hold keeps its speed-zero body length", () => {
  const chart = createChart();
  const line = chart.judgeLineList[0];
  line.eventLayers[0].moveYEvents = [createEvent(100, 0, 0, 10)];
  line.eventLayers[0].speedEvents = [createEvent(0)];
  const hold = createNote(2, 3, 0, 3);
  hold.speed = 0;
  line.notes = [hold];

  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const seconds = tempo.seconds(4);
  const state = scene.sample(seconds)[0];
  const entry = scene.lines[0].notes[0];
  const sampled = scene.lines[0].noteState(entry, state, seconds);

  assert.ok(
    Math.abs(sampled.tail - sampled.y) < 1e-6,
    "a speed-zero Hold does not trail the line's motion",
  );
  assert.equal(sampled.showHead, false, "only the tail cap is painted");
});

test("a timed speed-zero Hold does not trail the line's motion", () => {
  const chart = createChart();
  const line = chart.judgeLineList[0];
  line.eventLayers[0].moveYEvents = [createEvent(100, 0, 0, 10)];
  line.eventLayers[0].speedEvents = [createEvent(0)];
  const hold = createNote(2, 2, 0, 4);
  hold.speed = 0;
  line.notes = [hold];

  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const seconds = tempo.seconds(3);
  const state = scene.sample(seconds)[0];
  const entry = scene.lines[0].notes[0];
  const sampled = scene.lines[0].noteState(entry, state, seconds);

  assert.ok(
    Math.abs(sampled.tail - sampled.y) < 1e-6,
    "a Hold with a real time span keeps its speed-zero body length",
  );
});

test("a future zero-length Hold keeps its head cap", () => {
  const chart = createChart();
  const line = chart.judgeLineList[0];
  const hold = createNote(2, 5, 0, 5);
  hold.speed = 0;
  line.notes = [hold];

  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const start = tempo.seconds(5);
  const state = scene.sample(start - 0.01)[0];
  const entry = { note: hold, noteIndex: 0, start, end: start, floor: 0, tail: 0 };
  const sampled = scene.lines[0].noteState(entry, state, start - 0.01);

  assert.ok(Math.abs(sampled.tail - sampled.y) < 1e-9);
  assert.equal(sampled.showHead, true, "the head is painted before the Hold arrives");
});

test("an active Hold with a body still hides its head cap", () => {
  const chart = createChart();
  const line = chart.judgeLineList[0];
  const hold = createNote(2, 5, 0, 6);
  line.notes = [hold];

  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const start = tempo.seconds(5);
  const state = scene.sample(start + 0.01)[0];
  const entry = { note: hold, noteIndex: 0, start, end: tempo.seconds(6), floor: 0, tail: 120 };
  const sampled = scene.lines[0].noteState(entry, state, start + 0.01);

  assert.notEqual(sampled.tail, sampled.y);
  assert.equal(sampled.showHead, false);
});

test("a reversed hold is omitted from the scene runtime", () => {
  const chart = createChart();
  const line = chart.judgeLineList[0];
  const reversed = createNote(2, 8, 0, 4);
  reversed.endTime = fromNumber(4);
  line.notes = [reversed, createNote(2, 2, 0, 3)];

  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const seconds = tempo.seconds(1);
  const state = scene.sample(seconds)[0];
  const visible = scene.lines[0].visibleNotes(seconds, state, 1000);

  assert.deepEqual(
    visible.map((entry) => entry.noteIndex),
    [1],
    "reversed notes do not enter the scene's visible-note indexes",
  );
});

test("visibility expands each finite-speed note independently", () => {
  const note = createNote(1, 1, 0);
  note.speed = 0.01;
  const farFastNote = createNote(1, 1, 0);
  farFastNote.speed = 1;
  const entries = [
    { note, noteIndex: 0, start: 0, end: 1, floor: 100, tail: 100 },
    { note: farFastNote, noteIndex: 1, start: 0, end: 1, floor: 100, tail: 100 },
  ];
  const directory = new NoteVisibilityDirectory(entries, {
    floorExpansionFactor: (entry) => 1 / Math.abs(entry.note.speed ?? 1),
  });
  const result = [];

  directory.query(0.5, 0, 2, result);

  assert.deepEqual(
    result.map((entry) => entry.noteIndex),
    [0],
    "a tiny speed expands only its own spatial interval",
  );
});

test("unbounded distance models fall back to time instead of guessing", () => {
  const note = createNote(1, 1, 0);
  const entries = [{ note, noteIndex: 0, start: 10, end: 11, floor: 1e9, tail: 1e9 }];
  const directory = new NoteVisibilityDirectory(entries, {
    floorExpansionFactor: () => Infinity,
  });
  const result = [];

  directory.query(10.5, 0, 2, result);

  assert.deepEqual(
    result.map((entry) => entry.noteIndex),
    [0],
  );
});

test("negative and zero note speeds keep their safe branches", () => {
  const negative = createNote(1, 1, 0);
  negative.speed = -2;
  const zero = createNote(1, 1, 0);
  zero.speed = 0;
  const entries = [
    { note: negative, noteIndex: 0, start: 0, end: 1, floor: 1, tail: 1 },
    { note: zero, noteIndex: 1, start: 10, end: 11, floor: 1e9, tail: 1e9 },
  ];
  const directory = new NoteVisibilityDirectory(entries, {
    floorExpansionFactor: (entry) => {
      const speed = entry.note.speed ?? 1;
      return speed === 0 ? Infinity : 1 / Math.abs(speed);
    },
  });
  const result = [];

  directory.query(10.5, 0, 2, result);

  assert.deepEqual(
    result.map((entry) => entry.noteIndex),
    [1],
    "negative speed uses its magnitude and expired spatial candidates are removed by time",
  );
});
