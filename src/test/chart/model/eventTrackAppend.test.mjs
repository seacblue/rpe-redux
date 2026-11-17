/**
 * Event-track append fast path: appending after the compiled tail must produce
 * the same samples as a full rebuild, and unsafe appends must fall back exactly.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent } from "../../../core/global/chart/chart.ts";
import { EventTrack } from "../../../core/global/chart/timing/events.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";

/** A linear-contract event track with forty ordered events. */
function compiledTrack() {
  const chart = createChart();
  const tempo = new TempoMap(chart.BPMList);
  const events = [];
  for (let index = 0; index < 40; index += 1) {
    events.push(createEvent(index, index + 1, index, index + 1));
  }
  return { tempo, events, track: new EventTrack(events, tempo, 1, 0) };
}

/** Compare a cached track against a cold rebuild at representative times. */
function assertMatchesRebuild(cached, events, tempo) {
  const rebuilt = new EventTrack(events, tempo, 1, 0);
  assert.deepEqual(cached.sources, rebuilt.sources);
  for (const seconds of [0, 0.25, 0.5, 5, 10, 19, 20, 21]) {
    assert.deepEqual(cached.value(seconds), rebuilt.value(seconds), `value at ${seconds}s`);
  }
}

test("an ordered tail append matches a full rebuild", () => {
  const { tempo, events, track } = compiledTrack();
  const appended = createEvent(40, 41, 40, 41);
  const next = track.withSources([...events, appended]);

  assert.notEqual(next, track);
  assert.equal(next.sources.length, events.length + 1);
  assertMatchesRebuild(next, [...events, appended], tempo);
});

test("an earlier insertion falls back to a full rebuild", () => {
  const { tempo, events, track } = compiledTrack();
  const inserted = createEvent(5, 6, 5, 6);
  const next = track.withSources([...events, inserted]);

  assertMatchesRebuild(next, [...events, inserted], tempo);
});

test("an append that compaction would drop falls back exactly", () => {
  const chart = createChart();
  const tempo = new TempoMap(chart.BPMList);
  const events = [createEvent(0, 0, 0, 10)];
  const track = new EventTrack(events, tempo, 1, 0);
  const plateau = createEvent(0, 0, 10, 20);
  const next = track.withSources([...events, plateau]);

  assert.equal(next.sources.length, 1);
  assertMatchesRebuild(next, [...events, plateau], tempo);
});
