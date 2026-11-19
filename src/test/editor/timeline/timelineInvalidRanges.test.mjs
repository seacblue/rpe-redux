/** Timeline render caches project invalid durations without changing source indexes. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
} from "../../../core/global/chart/chart.ts";
import { fromNumber } from "../../../core/global/chart/timing/beat.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import { timelineRenderRange, timelineRenderRangeInto } from "../../../core/edit/timeline/model.ts";
import { TimelineCache } from "../../../frontend/screens/editor/workspace/timeline/drawing/timelineCache.ts";

test("timeline render ranges can reuse one target without changing projection", () => {
  const target = { start: 99, end: 99, invalid: true };
  const first = timelineRenderRangeInto(fromNumber(2), fromNumber(5), 4, target);
  assert.equal(first, target);
  assert.deepEqual(first, { start: 2, end: 5, invalid: false });

  const second = timelineRenderRangeInto(fromNumber(8), fromNumber(8), 4, target);
  assert.equal(second, target);
  assert.deepEqual(second, { start: 8, end: 8.25, invalid: true });
});

test("event render queries keep source indexes and project reversed events", () => {
  const chart = createChart();
  const reversed = createEvent(0, 1, 4, 2);
  const valid = createEvent(1, 2, 3, 5);
  const cache = new TimelineCache();

  assert.deepEqual(
    cache.eventEntries(chart, [reversed, valid], 0, 10, 11).map((entry) => entry.index),
    [0, 1],
  );
  assert.equal(cache.eventEntries(chart, [reversed, valid], 0, 10, 11)[0].start, 4);
  assert.equal(cache.eventEntries(chart, [reversed, valid], 0, 10, 11)[0].end, 4 + 1 / 11);
});

test("event render range cache follows grid density changes", () => {
  const chart = createChart();
  const reversed = createEvent(0, 1, 4, 2);
  const cache = new TimelineCache();

  assert.equal(cache.eventEntries(chart, [reversed], 0, 10, 4)[0].end, 4.25);
  assert.equal(cache.eventEntries(chart, [reversed], 0, 10, 8)[0].end, 4.125);
});

test("cached event entries match direct range projection", () => {
  const chart = createChart();
  const events = [createEvent(0, 1, 8, 4), createEvent(1, 2, 0, 3), createEvent(2, 3, 5, 5)];
  const cache = new TimelineCache();

  for (const gridCount of [1, 4, 16]) {
    const actual = cache
      .eventEntries(chart, events, -1, 12, gridCount)
      .map(({ index, start, end, invalid }) => ({ index, start, end, invalid }));
    const expected = events.map((event, index) => {
      const range = timelineRenderRange(event.startTime, event.endTime, gridCount);
      return { index, start: range.start, end: range.end, invalid: range.invalid };
    });
    assert.deepEqual(actual, expected);
  }
});

test("event lane ranges follow a replaced track under one chart identity", () => {
  const chart = createChart();
  const cache = new TimelineCache();
  const types = ["moveXEvents"];
  const event = createEvent(0, 100, 0, 4);
  const layer = { moveXEvents: [event] };

  const first = cache.events(chart, "0:false:0", types, layer);
  assert.equal(first.ranges[0].get(0).max, 100);

  // A paged document keeps the facade chart object; the replaced array is the
  // only signal that the derived lane range is stale.
  const edited = { ...event, end: 200 };
  const replaced = { moveXEvents: [edited] };
  const second = cache.events(chart, "0:false:0", types, replaced);
  assert.equal(second.ranges[0].get(0).max, 200);

  const reused = cache.events(chart, "0:false:0", types, replaced);
  assert.equal(reused, second, "an unchanged source array reuses the compiled lane");
});

test("note render queries project reversed holds without renumbering valid notes", () => {
  const reversed = createNote(2, 8, 0, 10);
  reversed.endTime = fromNumber(4);
  const valid = createNote(2, 2, 0, 3);
  const notes = [reversed, valid];
  const cache = new TimelineCache();
  cache.refreshNotes(0, notes);

  assert.deepEqual(
    cache.visibleNotes(0, 0, 10).map((entry) => entry.index),
    [1, 0],
  );
});

test("visual note array replacements reuse timing and non-overlap render caches", () => {
  const chart = createChart();
  const first = createNote(1, 0, 4);
  chart.judgeLineList[0].notes = [first];
  const cache = new TimelineCache();
  const tempo = new TempoMap(chart.BPMList);

  cache.refreshNotes(0, chart.judgeLineList[0].notes);
  const beforeData = cache.noteRenderDataSet(cache.noteIndex(0).notes, tempo, 1, 4);
  const beforeOverlap = cache.noteOverlapRanks(cache.noteIndex(0).notes, 0.01);

  const changed = { ...first, color: [1, 2, 3, 4] };
  cache.refreshNotes(0, [changed], {
    lineIndex: 0,
    noteIndexes: [0],
    kind: "visual",
    overlapChanged: false,
  });
  const afterData = cache.noteRenderDataSet(cache.noteIndex(0).notes, tempo, 1, 4);
  const afterOverlap = cache.noteOverlapRanks(cache.noteIndex(0).notes, 0.01);

  assert.strictEqual(afterData, beforeData);
  assert.strictEqual(afterOverlap, beforeOverlap);
  assert.equal(cache.noteIndex(0).index.rebuildCount, 1);
  assert.equal(cache.noteIndex(0).index.incrementalUpdateCount, 0);
});

test("merged note range queries return only lines that overlap the window", () => {
  const chart = createChart();
  chart.judgeLineList = [createLine("early"), createLine("late"), createLine("hold")];
  chart.judgeLineList[0].notes = [createNote(1, 0, 0)];
  chart.judgeLineList[1].notes = [createNote(1, 10, 0)];
  chart.judgeLineList[2].notes = [createNote(2, -1, 0, 1)];
  const cache = new TimelineCache();

  const query = cache.noteLinesInBeatRange(chart, -0.25, 0.25);

  assert.deepEqual(query.indices, [0, 2]);
  assert.equal(query.marks[0], query.generation);
  assert.notEqual(query.marks[1], query.generation);
  assert.equal(query.marks[2], query.generation);
});

test("merged note range queries reuse unchanged line sources after a chart replacement", () => {
  const chart = createChart();
  chart.judgeLineList = [createLine("early"), createLine("late")];
  chart.judgeLineList[0].notes = [createNote(1, 0, 0)];
  chart.judgeLineList[1].notes = [createNote(1, 10, 0)];
  const cache = new TimelineCache();
  cache.noteLinesInBeatRange(chart, -0.25, 0.25);

  const moved = { ...chart.judgeLineList[0], notes: [createNote(1, 20, 0)] };
  const replacement = { ...chart, judgeLineList: [moved, chart.judgeLineList[1]] };
  assert.deepEqual(cache.noteLinesInBeatRange(replacement, -0.25, 0.25).indices, []);
  assert.deepEqual(cache.noteLinesInBeatRange(replacement, 19.75, 20.25).indices, [0]);
});
