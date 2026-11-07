/** Exercises object-addressed chart diffs and atomic room patch application. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyChartChanges,
  diffCharts,
  stableFingerprint,
} from "../../../core/collaboration/changes.ts";

function chart() {
  return {
    META: { name: "before" },
    BPMList: [{ beat: [0, 0, 1], bpm: 120 }],
    judgeLineList: [
      {
        id: "line-a",
        name: "A",
        notes: [
          { id: "note-a1", positionX: 1, alpha: 255 },
          { id: "note-a2", positionX: 2, alpha: 255 },
        ],
        eventLayers: [{ id: "layer-a", moveXEvents: [{ id: "event-a", start: 0, end: 1 }] }],
      },
      {
        id: "line-b",
        name: "B",
        notes: [{ id: "note-b1", positionX: 3, alpha: 255 }],
        eventLayers: [{ id: "layer-b", moveXEvents: [] }],
      },
    ],
  };
}

function changedNote(source, lineIndex, noteIndex, patch) {
  const next = structuredClone(source);
  Object.assign(next.judgeLineList[lineIndex].notes[noteIndex], patch);
  return next;
}

test("independent object edits merge through separate transactions", () => {
  const base = chart();
  const first = changedNote(base, 0, 0, { positionX: 20 });
  const second = changedNote(base, 0, 1, { positionX: 30 });
  const firstChanges = diffCharts(base, first);
  const secondChanges = diffCharts(base, second);
  const appliedFirst = applyChartChanges(base, firstChanges);
  assert.deepEqual(appliedFirst.conflicts, []);
  const appliedSecond = applyChartChanges(appliedFirst.chart, secondChanges);
  assert.deepEqual(appliedSecond.conflicts, []);
  assert.deepEqual(
    appliedSecond.chart.judgeLineList[0].notes.map((note) => note.positionX),
    [20, 30],
  );
});

test("a later edit to the same field conflicts instead of overwriting", () => {
  const base = chart();
  const first = changedNote(base, 0, 0, { positionX: 20 });
  const second = changedNote(base, 0, 0, { positionX: 30 });
  const appliedFirst = applyChartChanges(base, diffCharts(base, first));
  const appliedSecond = applyChartChanges(appliedFirst.chart, diffCharts(base, second));
  assert.equal(appliedSecond.conflicts.length, 1);
  assert.equal(appliedSecond.chart, appliedFirst.chart);
});

test("inserting and deleting id-addressed notes stays isolated", () => {
  const base = chart();
  const next = structuredClone(base);
  next.judgeLineList[0].notes.splice(0, 1);
  next.judgeLineList[0].notes.push({ id: "note-a3", positionX: 4, alpha: 255 });
  const changes = diffCharts(base, next);
  assert.equal(
    changes.some((change) => change.op === "add"),
    true,
  );
  assert.equal(
    changes.some((change) => change.op === "remove"),
    true,
  );
  const applied = applyChartChanges(base, changes);
  assert.deepEqual(applied.conflicts, []);
  assert.deepEqual(
    applied.chart.judgeLineList[0].notes.map((note) => note.id),
    ["note-a2", "note-a3"],
  );
});

test("reordering an id array is atomic and rejects a stale base", () => {
  const base = chart();
  const reordered = structuredClone(base);
  reordered.judgeLineList.reverse();
  const changes = diffCharts(base, reordered);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].op, "set");
  assert.equal(applyChartChanges(base, changes).conflicts.length, 0);
  const edited = changedNote(base, 0, 0, { positionX: 99 });
  assert.equal(applyChartChanges(edited, changes).conflicts.length, 1);
});

test("malformed paths and empty batches leave the chart untouched", () => {
  const base = chart();
  const result = applyChartChanges(base, [
    { op: "set", path: "/judgeLineList/$missing/name", before: "A", after: "B" },
  ]);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.chart, base);
  assert.deepEqual(applyChartChanges(base, []), { chart: base, conflicts: [] });
});

test("the stable fingerprint ignores object key order", () => {
  assert.equal(stableFingerprint({ a: 1, b: [2, 3] }), stableFingerprint({ b: [2, 3], a: 1 }));
  assert.notEqual(stableFingerprint({ a: 1 }), stableFingerprint({ a: 2 }));
});

test("a set on an existing id or index replaces the addressed value", () => {
  const base = chart();
  const note = base.judgeLineList[0].notes[0];
  const bpm = base.BPMList[0];
  const result = applyChartChanges(base, [
    {
      op: "set",
      path: "/judgeLineList/$line-a/notes/$note-a1",
      before: note,
      after: { ...note, positionX: 9 },
    },
    { op: "set", path: "/BPMList/0", before: bpm, after: { ...bpm, bpm: 180 } },
  ]);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.chart.judgeLineList[0].notes.length, 2);
  assert.equal(result.chart.judgeLineList[0].notes[0].positionX, 9);
  assert.equal(result.chart.BPMList[0].bpm, 180);
});

test("remote note changes preserve unrelated chart subtrees", () => {
  const base = chart();
  base.judgeLineList[0].notes = Array.from({ length: 10_000 }, (_, index) => ({
    id: `note-large-${index}`,
    positionX: index,
    alpha: 255,
  }));
  const changed = {
    ...base,
    judgeLineList: base.judgeLineList.map((line, lineIndex) =>
      lineIndex === 0
        ? {
            ...line,
            notes: line.notes.map((note, noteIndex) =>
              noteIndex === 5_000 ? { ...note, positionX: 99 } : note,
            ),
          }
        : line,
    ),
  };
  const result = applyChartChanges(base, diffCharts(base, changed));

  assert.deepEqual(result.conflicts, []);
  assert.equal(result.chart.judgeLineList[1], base.judgeLineList[1]);
  assert.equal(result.chart.judgeLineList[0].notes[0], base.judgeLineList[0].notes[0]);
  assert.notEqual(result.chart.judgeLineList[0].notes[5_000], base.judgeLineList[0].notes[5_000]);
  assert.equal(result.chart.judgeLineList[0].notes[5_000].positionX, 99);
});
