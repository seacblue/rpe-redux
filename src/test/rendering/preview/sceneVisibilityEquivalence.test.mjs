/** Differentially checks the conservative visibility directory against the previous broad phase. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createNote } from "../../../core/global/chart/chart.ts";
import { NoteVisibilityDirectory } from "../../../core/global/chart/runtime/noteVisibility.ts";
import { SceneRuntime } from "../../../core/global/chart/runtime/scene.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";

/** Apply the final visibility rules shared by the old and new broad phases. */
function finalVisible(runtime, entries, seconds, state) {
  return entries.filter((entry) => {
    if (entry.end < seconds || entry.start - seconds > (entry.note.visibleTime ?? 999999)) {
      return false;
    }
    return !(
      runtime.line.isCover === 1 &&
      (entry.note.speed ?? 1) !== 0 &&
      (entry.note.type === 2 ? entry.tail : entry.floor) < state.floor
    );
  });
}

/** Reproduce the previous global-minimum-speed broad phase for comparison. */
function previousVisible(runtime, seconds, state, radius) {
  const notes = runtime.notes;
  const minSpeed = notes.reduce(
    (minimum, entry) => Math.min(minimum, Math.abs(entry.note.speed ?? 1) || 1),
    1,
  );
  let candidates;
  if (runtime.hasYControl) {
    candidates = [...notes];
  } else {
    const range = radius / minSpeed;
    candidates = notes.filter((entry) => {
      const speed = entry.note.speed ?? 1;
      if (speed === 0) {
        return entry.start - (entry.note.visibleTime ?? 999999) <= seconds && entry.end >= seconds;
      }
      return (
        Math.max(entry.floor, entry.tail) >= state.floor - range &&
        Math.min(entry.floor, entry.tail) <= state.floor + range
      );
    });
  }
  return finalVisible(runtime, candidates, seconds, state);
}

/** Return the authored note indexes in a set-like form. */
function indexes(entries) {
  return new Set(entries.map((entry) => entry.noteIndex));
}

/** Return notes whose exact sampled geometry is inside the requested broad-phase radius. */
function geometricallyInside(runtime, seconds, state, radius) {
  return indexes(
    finalVisible(runtime, runtime.notes, seconds, state).filter((entry) => {
      const position = runtime.noteState(entry, state, seconds);
      return (
        Math.hypot(position.x, position.y) <= radius ||
        Math.hypot(position.x, position.tail) <= radius
      );
    }),
  );
}

/** Deterministic pseudo-random values keep the branch matrix reproducible. */
function random(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

test("the per-note directory preserves geometric recall and removes old overdraw", () => {
  const chart = createChart();
  const line = chart.judgeLineList[0];
  const next = random(0x51f15e);
  const speeds = [-4, -0.25, -0.01, 0, 0.01, 0.5, 1, 2, 8];
  line.eventLayers[0].speedEvents = [
    createEvent(-2, 6, 0, 4),
    createEvent(6, -3, 4, 8),
    createEvent(-3, 2, 8, 12),
  ];
  line.notes = Array.from({ length: 96 }, (_, index) => {
    const note = createNote(1, next() * 20, (next() - 0.5) * 1350);
    note.speed = speeds[Math.floor(next() * speeds.length)];
    note.visibleTime = 0.25 + next() * 3;
    note.yOffset = (next() - 0.5) * 80;
    note.id = `visibility-${index}`;
    return note;
  });

  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const runtime = scene.lines[0];

  for (const beat of [1, 4.5, 8.25, 11.5, 17]) {
    const seconds = tempo.seconds(beat);
    const state = scene.sample(seconds)[0];
    for (const radius of [80, 320, 1600]) {
      const previous = indexes(previousVisible(runtime, seconds, state, radius));
      const current = indexes(runtime.visibleNotes(seconds, state, radius));
      const exact = geometricallyInside(runtime, seconds, state, radius);

      for (const index of exact) {
        assert.ok(current.has(index), `new directory omitted geometrically visible note ${index}`);
        assert.ok(
          previous.has(index),
          `previous broad phase omitted geometrically visible note ${index}`,
        );
      }
      for (const index of current) {
        assert.ok(previous.has(index), `new directory introduced an unproven candidate ${index}`);
      }
      assert.ok(
        current.size <= previous.size,
        `new directory returned more candidates (${current.size}) than the old phase (${previous.size})`,
      );
    }
  }
});

test("Y control and Hold fallback keep the old final set exactly", () => {
  const chart = createChart();
  const line = chart.judgeLineList[0];
  line.yControl = [
    { x: 0, y: 0.25 },
    { x: 1000, y: 1.75 },
  ];
  line.notes = [createNote(1, 2, 0), createNote(2, 2, 0, 12), createNote(1, 8, 0)];
  line.notes[0].speed = -2;
  line.notes[1].speed = 0;
  line.notes[2].speed = 0.01;

  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const runtime = scene.lines[0];
  const seconds = tempo.seconds(6);
  const state = scene.sample(seconds)[0];
  const previous = indexes(previousVisible(runtime, seconds, state, 320));
  const current = indexes(runtime.visibleNotes(seconds, state, 320));

  assert.deepEqual([...current].sort(), [...previous].sort());
});

test("Y-control visibility keeps ordered candidates and repairs unordered candidates", () => {
  const chart = createChart();
  const line = chart.judgeLineList[0];
  line.yControl = [
    { x: 0, y: 0.25 },
    { x: 1000, y: 1.75 },
  ];
  line.notes = [createNote(1, 2, 0), createNote(1, 2, 20), createNote(1, 2, 40)];
  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const runtime = scene.lines[0];
  const seconds = tempo.seconds(2);
  const state = scene.sample(seconds)[0];
  const ordered = [...runtime.notes];
  const candidates = runtime.visibility.query.bind(runtime.visibility);
  for (const source of [ordered, [...ordered].reverse()]) {
    runtime.visibility.query = (_seconds, _floor, _radius, result) => {
      result.length = 0;
      result.push(...source);
      return result;
    };
    assert.deepEqual(
      runtime.visibleNotes(seconds, state, 320).map((entry) => entry.noteIndex),
      [0, 1, 2],
    );
  }
  runtime.visibility.query = candidates;
});

test("visibility metrics account for candidates, final results, and index time", () => {
  const chart = createChart();
  const line = chart.judgeLineList[0];
  const ordinary = createNote(1, 2, 0);
  ordinary.speed = 0.25;
  const staticNote = createNote(1, 3, 0);
  staticNote.speed = 0;
  const hold = createNote(2, 2, 0, 8);
  line.notes = [ordinary, staticNote, hold];

  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const runtime = scene.lines[0];
  const seconds = tempo.seconds(2.5);
  const state = scene.sample(seconds)[0];
  const visible = runtime.visibleNotes(seconds, state, 320);
  const stats = runtime.lastVisibilityStats;

  assert.equal(
    stats.candidateCount,
    stats.spatialCandidateCount + stats.temporalCandidateCount + stats.holdCandidateCount,
  );
  assert.equal(stats.visibleCount, visible.length);
  assert.ok(stats.candidateCount >= stats.visibleCount);
  assert.ok(stats.indexMs >= 0);
});

test("spatial-only visibility avoids fallback work without changing results", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes = [createNote(1, 2, 0), createNote(1, 4, 240)];

  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const runtime = scene.lines[0];
  const seconds = tempo.seconds(2);
  const state = scene.sample(seconds)[0];
  const visible = runtime.visibleNotes(seconds, state, 320);
  const stats = runtime.lastVisibilityStats;

  assert.equal(stats.temporalCandidateCount, 0);
  assert.equal(stats.holdCandidateCount, 0);
  assert.equal(stats.candidateCount, stats.spatialCandidateCount);
  assert.equal(stats.visibleCount, visible.length);
});

test("speed-zero Holds use one time interval without duplicate candidates", () => {
  const chart = createChart();
  const hold = createNote(2, 2, 0, 8);
  hold.speed = 0;
  chart.judgeLineList[0].notes = [hold];

  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const runtime = scene.lines[0];
  const seconds = tempo.seconds(4);
  const state = scene.sample(seconds)[0];
  const visible = runtime.visibleNotes(seconds, state, 320);
  const stats = runtime.lastVisibilityStats;

  assert.equal(new Set(visible).size, visible.length);
  assert.equal(stats.holdCandidateCount, 1);
  assert.equal(stats.candidateCount, stats.spatialCandidateCount + stats.holdCandidateCount);
});

test("spatial candidates also honor the Hold activity time intersection", () => {
  const hold = createNote(2, 1, 0, 2);
  const entry = { note: hold, noteIndex: 0, start: 1, end: 2, floor: 0, tail: 0 };
  const directory = new NoteVisibilityDirectory([entry], {
    floorExpansionFactor: () => 1,
  });
  const result = [];

  directory.query(3, 0, 320, result);
  assert.deepEqual(result, [], "an ended Hold is removed by the spatial time intersection");

  directory.query(1.5, 0, 320, result);
  assert.deepEqual(
    result.map((candidate) => candidate.noteIndex),
    [0],
  );
});

test("a certified monotone floor skips active Hold indexing, while reversals stay conservative", () => {
  const monotoneChart = createChart();
  const monotoneLine = monotoneChart.judgeLineList[0];
  monotoneLine.notes = [createNote(2, 2, 0, 8)];
  monotoneLine.eventLayers[0].speedEvents = [createEvent(2, 4, 0, 4), createEvent(4, 1, 4, 8)];

  const tempo = new TempoMap(monotoneChart.BPMList);
  const monotoneScene = new SceneRuntime();
  monotoneScene.compile(monotoneChart, tempo);
  const monotoneRuntime = monotoneScene.lines[0];

  assert.equal(monotoneRuntime.holdActivationCoveredBySpatial, true);
  assert.equal(monotoneRuntime.visibility.holdActiveIndex.size, 0);

  const reversingChart = createChart();
  const reversingLine = reversingChart.judgeLineList[0];
  reversingLine.notes = [createNote(2, 2, 0, 8)];
  reversingLine.eventLayers[0].speedEvents = [createEvent(2, -2, 0, 4), createEvent(-2, 2, 4, 8)];

  const reversingScene = new SceneRuntime();
  reversingScene.compile(reversingChart, new TempoMap(reversingChart.BPMList));
  const reversingRuntime = reversingScene.lines[0];

  assert.equal(reversingRuntime.holdActivationCoveredBySpatial, false);
  assert.equal(reversingRuntime.visibility.holdActiveIndex.size, 1);
});
