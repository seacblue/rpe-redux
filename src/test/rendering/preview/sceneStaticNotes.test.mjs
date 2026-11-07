/** Verifies speed-zero notes use the visible-time index without changing author order. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createNote } from "../../../core/global/chart/chart.ts";
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
