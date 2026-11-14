/** Hit-sound replay: the per-timestamp voice budget resets between transport runs. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createNote } from "../../core/global/chart/chart.ts";
import { TempoMap } from "../../core/global/chart/timing/tempo.ts";
import { HitSounds } from "../../core/media/hitsounds.ts";

/** Build a one-line 120 BPM chart with the supplied notes. */
function chartWith(notes) {
  const chart = createChart();
  chart.BPMList = [{ bpm: 120, startTime: [0, 0, 1] }];
  chart.META.offset = 0;
  chart.judgeLineList[0].notes = notes;
  return chart;
}

/** A fake transport the scheduler can read without creating an AudioContext. */
function transportStub() {
  return {
    playing: true,
    clockReady: true,
    playRevision: 0,
    rate: 1,
    audioTime: 0,
    scheduleHorizon: Infinity,
    context: null,
    backgroundGain: null,
    ensureContext() {
      return null;
    },
  };
}

/** Connect one HitSounds player to a chart and record every trigger decision. */
function playerFor(chart) {
  const transport = transportStub();
  const hits = new HitSounds(transport);
  hits.setProject(chart, {}, "replay-fixture");
  hits.gain = {};
  hits.buffers.set("tap", {});
  const results = [];
  const accept = hits.soundPolicy.accept.bind(hits.soundPolicy);
  hits.soundPolicy.accept = (resource, seconds) => {
    const accepted = accept(resource, seconds);
    results.push(accepted);
    return accepted;
  };
  return { hits, transport, tempo: new TempoMap(chart.BPMList), results };
}

test("replaying the same segment keeps an isolated Hold hit sound", () => {
  // Head at beat 2 (1.0s), tail at beat 12: one trigger at the same time.
  const chart = chartWith([createNote(2, 2, 0, 12)]);
  const { hits, transport, tempo, results } = playerFor(chart);

  for (let replay = 0; replay < 8; replay += 1) {
    transport.playRevision += 1;
    transport.audioTime = 1.0;
    hits.tick(chart, tempo, 0);
  }

  assert.equal(results.length, 8);
  assert.ok(
    results.every(Boolean),
    "the same timestamp must be accepted once per replay, not accumulate",
  );
});

test("the per-timestamp cap still bounds one transport run", () => {
  // Six simultaneous taps: the default limit of five accepts exactly five.
  const chart = chartWith(Array.from({ length: 6 }, (_, index) => createNote(1, 2, index * 10)));
  const { hits, transport, tempo, results } = playerFor(chart);

  transport.playRevision += 1;
  transport.audioTime = 1.0;
  hits.tick(chart, tempo, 0);

  assert.equal(results.length, 6);
  assert.equal(results.filter(Boolean).length, 5);
});
