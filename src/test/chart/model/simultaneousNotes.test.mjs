/**
 * Incremental simultaneous-note detection: appends reuse cached note times,
 * while replacements and removals still match the whole-chart rule.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createLine, createNote } from "../../../core/global/chart/chart.ts";
import {
  simultaneousNotes,
  SimultaneousNotesCache,
} from "../../../core/global/chart/line/simultaneousNotes.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";

test("an appended note joins its time group without recomputing the line", () => {
  const chart = createChart();
  chart.judgeLineList = [];
  const first = createLine("First");
  first.notes = [createNote(1, 0, 0)];
  const second = createLine("Second");
  second.notes = [createNote(1, 2, 0)];
  chart.judgeLineList.push(first, second);
  const tempo = new TempoMap(chart.BPMList);
  const cache = new SimultaneousNotesCache();

  assert.equal(cache.update(chart, tempo).size, 0);

  const appended = createNote(1, 0, 1);
  const nextNotes = [...first.notes, appended];
  chart.judgeLineList[0] = { ...first, notes: nextNotes };
  const simultaneous = cache.update(chart, tempo);

  assert.deepEqual(new Set(simultaneous), new Set([first.notes[0], appended]));
  assert.deepEqual(new Set(simultaneous), simultaneousNotes(chart, tempo));
});

test("replacing and removing notes keep the incremental cache exact", () => {
  const chart = createChart();
  chart.judgeLineList = [];
  const first = createLine("First");
  first.notes = [createNote(1, 1, 0), createNote(1, 2, 0)];
  const second = createLine("Second");
  second.notes = [createNote(1, 1, 0), createNote(1, 3, 0)];
  chart.judgeLineList.push(first, second);
  const tempo = new TempoMap(chart.BPMList);
  const cache = new SimultaneousNotesCache();
  assert.deepEqual(new Set(cache.update(chart, tempo)), simultaneousNotes(chart, tempo));

  const replacement = createNote(1, 3, 1);
  chart.judgeLineList[0] = {
    ...first,
    notes: [first.notes[0], replacement],
  };
  assert.deepEqual(new Set(cache.update(chart, tempo)), simultaneousNotes(chart, tempo));

  chart.judgeLineList[1] = { ...chart.judgeLineList[1], notes: [] };
  assert.deepEqual(new Set(cache.update(chart, tempo)), simultaneousNotes(chart, tempo));
});
