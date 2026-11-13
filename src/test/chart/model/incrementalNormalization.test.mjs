/**
 * Guards incremental id normalization on copy-on-write chart copies.
 *
 * A transaction chart shares every untouched line object with the chart it was
 * cloned from, so incremental normalization must skip those lines instead of
 * paying a per-line set allocation and two layer-array layouts. The duplicated
 * and reordered cases below pin the other half of the contract: whenever an id
 * cannot be attributed to the previous revision, the whole-chart pass must still
 * run and repair it.
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
  normalizeChartObjectIds,
} from "../../../core/global/chart/chart.ts";
import {
  createChartIdentityFactory,
  createChartObjectId,
  isChartObjectId,
} from "../../../core/global/chart/identity.ts";

/**
 * Builds a normalized chart with `lineCount` lines, `notesPerLine` notes each,
 * and a small alpha event track on every line.
 *
 * @param {number} lineCount judge line count
 * @param {number} notesPerLine notes per line
 * @returns {import("../../../core/global/chart/chart.ts").Chart} normalized chart
 */
function makeChart(lineCount, notesPerLine) {
  const chart = createChart();
  chart.BPMList = [{ bpm: 180, startTime: [0, 0, 1] }];
  chart.judgeLineList = [];
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const line = createLine(`Line ${lineIndex}`);
    line.notes = [];
    for (let noteIndex = 0; noteIndex < notesPerLine; noteIndex += 1) {
      line.notes.push(createNote(noteIndex % 5 === 0 ? 2 : 1, noteIndex / 4, noteIndex));
    }
    line.numOfNotes = line.notes.reduce((sum, note) => sum + (note.type === 2 ? 0 : 1), 0);
    line.eventLayers[0].alphaEvents = [createEvent(255, 0, 0, 1), createEvent(0, 255, 1, 2)];
    chart.judgeLineList.push(line);
  }
  return normalizeChartObjectIds(chart);
}

/** Collects every id-bearing object in chart traversal order. */
function chartObjects(chart) {
  const objects = [];
  for (const line of chart.judgeLineList ?? []) {
    objects.push(line);
    for (const note of line.notes ?? []) {
      objects.push(note);
    }
    for (const layer of [...(line.eventLayers ?? []), line.extended]) {
      if (!layer) {
        continue;
      }
      for (const value of Object.values(layer)) {
        if (Array.isArray(value)) {
          for (const event of value) {
            objects.push(event);
          }
        }
      }
    }
  }
  return objects;
}

/**
 * Asserts every id-bearing object has a valid, unique id.
 *
 * @param {import("../../../core/global/chart/chart.ts").Chart} chart chart to check
 * @returns {Set<string>} the ids found
 */
function assertValidUniqueIds(chart) {
  const ids = new Set();
  for (const object of chartObjects(chart)) {
    assert.ok(isChartObjectId(object.id), `object without a valid id: ${object.id}`);
    assert.equal(ids.has(object.id), false, `duplicate id: ${object.id}`);
    ids.add(object.id);
  }
  return ids;
}

/**
 * Builds a transaction-shaped copy-on-write clone of one chart.
 *
 * Line 10 is replaced by a clone with one replaced note, mirroring what a note
 * update transaction does; every other line stays the same object.
 *
 * @param {import("../../../core/global/chart/chart.ts").Chart} base chart to clone
 * @returns {import("../../../core/global/chart/chart.ts").Chart} clone with one changed line
 */
function cowClone(base) {
  const derived = { ...base, judgeLineList: [...base.judgeLineList] };
  const changed = { ...base.judgeLineList[10] };
  changed.notes = base.judgeLineList[10].notes.map((note) => ({ ...note }));
  changed.notes[5].positionX = 999;
  derived.judgeLineList[10] = changed;
  return derived;
}

test("untouched lines cost nothing and keep their identity", () => {
  const base = makeChart(200, 20);
  const baseNoteIds = base.judgeLineList.map((line) => line.notes.map((note) => note.id));

  const times = [];
  let derived;
  for (let round = 0; round < 20; round += 1) {
    derived = cowClone(base);
    const start = performance.now();
    normalizeChartObjectIds(derived, createChartIdentityFactory(), base);
    times.push(performance.now() - start);
  }
  times.sort((left, right) => left - right);
  // A whole-chart pass over 200 lines takes visible milliseconds; the
  // untouched-line skip keeps incremental normalization far below that.
  assert.ok(times[Math.floor(times.length / 2)] < 20, `normalize med ${times[10]}ms`);

  for (let lineIndex = 0; lineIndex < 200; lineIndex += 1) {
    if (lineIndex === 10) {
      continue;
    }
    assert.equal(
      derived.judgeLineList[lineIndex],
      base.judgeLineList[lineIndex],
      `untouched line ${lineIndex} kept its object`,
    );
    assert.deepEqual(
      derived.judgeLineList[lineIndex].notes.map((note) => note.id),
      baseNoteIds[lineIndex],
      `untouched line ${lineIndex} kept its note ids`,
    );
  }
  assert.equal(derived.judgeLineList[10].notes[5].positionX, 999);
  assertValidUniqueIds(derived);
});

test("a copied line with duplicate ids falls back to the full repair pass", () => {
  const base = makeChart(40, 10);
  const derived = { ...base, judgeLineList: [...base.judgeLineList] };
  // A deep copy keeps every id of the source line, so the chart now carries two
  // lines and two note sets with the same ids.
  derived.judgeLineList.push(structuredClone(base.judgeLineList[0]));

  normalizeChartObjectIds(derived, createChartIdentityFactory(), base);

  assert.notEqual(
    derived.judgeLineList[40].id,
    base.judgeLineList[0].id,
    "the duplicated line received a fresh id",
  );
  assert.equal(
    derived.judgeLineList[0].id,
    base.judgeLineList[0].id,
    "the original line kept its id",
  );
  const copiedNoteIds = derived.judgeLineList[40].notes.map((note) => note.id);
  assert.equal(new Set(copiedNoteIds).size, copiedNoteIds.length);
  for (const [index, id] of copiedNoteIds.entries()) {
    assert.notEqual(id, base.judgeLineList[0].notes[index].id);
  }
  assertValidUniqueIds(derived);
});

test("a duplicated note inside a cloned line is reassigned", () => {
  const base = makeChart(10, 10);
  const derived = { ...base, judgeLineList: [...base.judgeLineList] };
  const changed = { ...base.judgeLineList[3] };
  changed.notes = base.judgeLineList[3].notes.map((note) => ({ ...note }));
  changed.notes[2].id = changed.notes[6].id;
  derived.judgeLineList[3] = changed;

  normalizeChartObjectIds(derived, createChartIdentityFactory(), base);

  assertValidUniqueIds(derived);
  // The duplicate is repaired by reassigning one of the two slots; the other
  // keeps the id it borrowed, so the pair is still two distinct ids.
  const repaired = derived.judgeLineList[3].notes;
  assert.notEqual(repaired[2].id, repaired[6].id);
  const sourceIds = [base.judgeLineList[3].notes[2].id, base.judgeLineList[3].notes[6].id];
  assert.equal([repaired[2].id, repaired[6].id].filter((id) => sourceIds.includes(id)).length, 1);
});

test("a reordered judge line list still normalizes and keeps its ids", () => {
  const base = makeChart(30, 8);
  const idsBefore = assertValidUniqueIds(base);
  const derived = { ...base, judgeLineList: [...base.judgeLineList].reverse() };

  const normalized = normalizeChartObjectIds(derived, createChartIdentityFactory(), base);

  assert.equal(normalized, derived);
  assert.equal(derived.judgeLineList[0], base.judgeLineList[29]);
  assert.equal(derived.judgeLineList[29], base.judgeLineList[0]);
  const idsAfter = assertValidUniqueIds(derived);
  assert.deepEqual([...idsAfter].sort(), [...idsBefore].sort());
});

test("a copy-on-write clone keeps every id valid and unique", () => {
  const base = makeChart(60, 12);
  const baseObjects = chartObjects(base);
  const derived = cowClone(base);
  // Also clone one event track, the shape an event update transaction produces.
  const changedLine = { ...derived.judgeLineList[20] };
  const layers = [...changedLine.eventLayers];
  layers[0] = { ...layers[0], alphaEvents: layers[0].alphaEvents.map((event) => ({ ...event })) };
  changedLine.eventLayers = layers;
  derived.judgeLineList[20] = changedLine;

  normalizeChartObjectIds(derived, createChartIdentityFactory(), base);

  const derivedObjects = chartObjects(derived);
  assert.equal(derivedObjects.length, baseObjects.length);
  assertValidUniqueIds(derived);
  const baseIds = new Set(baseObjects.map((object) => object.id));
  const derivedIds = new Set(derivedObjects.map((object) => object.id));
  assert.deepEqual([...derivedIds].sort(), [...baseIds].sort());
  // The recombined line and its events are new objects that kept their ids.
  assert.notEqual(derived.judgeLineList[20], base.judgeLineList[20]);
  assert.equal(
    derived.judgeLineList[20].eventLayers[0].alphaEvents[0].id,
    base.judgeLineList[20].eventLayers[0].alphaEvents[0].id,
  );
});

test("a genuinely new line with an unknown line id repairs its copied note ids", () => {
  const base = makeChart(20, 6);
  const derived = { ...base, judgeLineList: [...base.judgeLineList] };
  const extra = structuredClone(base.judgeLineList[0]);
  extra.id = createChartObjectId();
  derived.judgeLineList.push(extra);

  normalizeChartObjectIds(derived, createChartIdentityFactory(), base);

  assert.equal(derived.judgeLineList[20].id, extra.id);
  assertValidUniqueIds(derived);
  for (const [index, note] of derived.judgeLineList[20].notes.entries()) {
    assert.notEqual(note.id, base.judgeLineList[0].notes[index].id);
  }
});
