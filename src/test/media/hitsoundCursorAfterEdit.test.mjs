/** A paused edit rebuilds the trigger list and reschedules the cut look-ahead. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createNote } from "../../core/global/chart/chart.ts";
import { TempoMap } from "../../core/global/chart/timing/tempo.ts";
import { HitSounds } from "../../core/media/hitsounds.ts";

/** A one-line 120 BPM chart with the supplied notes. */
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
    playing: false,
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

/** Connect one player that records the triggers it schedules. */
function playerFor(chart) {
  const transport = transportStub();
  const hits = new HitSounds(transport);
  hits.setProject(chart, {}, "cursor-fixture");
  hits.buffers.set("tap", {});
  hits.buffers.set("drag", {});
  const played = [];
  hits.playEntry = (entry) => played.push(entry);
  return { hits, transport, tempo: new TempoMap(chart.BPMList), played };
}

test("editing a queued note while paused reschedules it from the playhead", () => {
  const chart = chartWith([createNote(1, 2, 0)]);
  const { hits, transport, tempo, played } = playerFor(chart);

  transport.playing = true;
  transport.playRevision = 1;
  transport.audioTime = 0.95;
  hits.tick(chart, tempo, null, 0, 0);
  assert.deepEqual(
    played.map((entry) => entry.sound),
    ["tap"],
    "the note at 1.0s is queued before the edit",
  );

  transport.playing = false;
  transport.playRevision += 1;
  transport.audioTime = 1;
  hits.tick(chart, tempo, null, 0, 0);
  played.length = 0;

  chart.judgeLineList[0].notes = [{ ...chart.judgeLineList[0].notes[0], type: 4 }];
  transport.playing = true;
  transport.playRevision += 1;
  // The first playing frame is 30ms past the paused position; the scheduler
  // must anchor to the paused position, not to that advanced frame.
  transport.audioTime = 1.03;
  hits.tick(chart, tempo, null, 1, 1);

  assert.deepEqual(
    played.map((entry) => entry.sound),
    ["drag"],
    "the edited note must sound again from the same playhead",
  );
});

test("a note placed at the paused playhead is scheduled when playback resumes", () => {
  const chart = chartWith([createNote(1, 2.1, 0)]);
  const { hits, transport, tempo, played } = playerFor(chart);

  transport.playing = true;
  transport.playRevision = 1;
  transport.audioTime = 0.95;
  hits.tick(chart, tempo, null, 0, 0);
  assert.deepEqual(
    played.map((entry) => entry.time),
    [1.05],
    "the look-ahead queued the existing note",
  );

  transport.playing = false;
  transport.playRevision += 1;
  transport.audioTime = 1;
  hits.tick(chart, tempo, null, 0, 0);
  played.length = 0;

  chart.judgeLineList[0].notes = [...chart.judgeLineList[0].notes, createNote(1, 2, 50)];
  transport.playing = true;
  transport.playRevision += 1;
  transport.audioTime = 1.03;
  hits.tick(chart, tempo, null, 1, 1);

  assert.ok(
    played.some((entry) => entry.time === 1),
    "the note inserted at the playhead must enter the look-ahead",
  );
});
