/** Timeline render caches project invalid durations without changing source indexes. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createNote } from "../../../core/global/chart/chart.ts";
import { fromNumber } from "../../../core/global/chart/timing/beat.ts";
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
