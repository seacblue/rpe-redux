/** A chart offset edit mid-playback must not silence or shift the next hit sound. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createNote } from "../../core/global/chart/chart.ts";
import { chartWithOffsetDraft } from "../../core/global/chart/editing/drafts.ts";
import { TempoMap } from "../../core/global/chart/timing/tempo.ts";
import { EditorSession } from "../../core/edit/session/session.ts";
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
function transportStub(position = 0) {
  return {
    playing: true,
    clockReady: true,
    playRevision: 1,
    rate: 1,
    position,
    scheduleHorizon: Infinity,
    context: null,
    backgroundGain: null,
    get audioTime() {
      return this.position;
    },
    ensureContext() {
      return null;
    },
  };
}

/** Connect a HitSounds player that records what it would sound. */
function playerFor(chart, position = 0) {
  const transport = transportStub(position);
  const hits = new HitSounds(transport);
  hits.setProject(chart, {}, "offset-playback-fixture");
  hits.gain = {};
  hits.buffers.set("flick", {});
  const played = [];
  hits.playEntry = (entry) => played.push(entry.time);
  return { hits, transport, played, tempo: new TempoMap(chart.BPMList) };
}

/** Commit the offset the way the timing panel does. */
function commitOffset(session, offsetMs) {
  session.commitChart(
    "offset",
    chartWithOffsetDraft(session.chart, String(offsetMs)),
    session.selectionState(),
    undefined,
    { normalized: true },
  );
}

/** Run the scheduler for the live session. */
function tick(hits, session, tempo) {
  hits.tick(session.chart, tempo, null, session.contentRevision, session.history.contentRevision);
}

test("an offset edit while playing does not replay sounds already heard", () => {
  const chart = chartWith([createNote(3, 2, 0), createNote(3, 4, 0), createNote(3, 6, 0)]);
  const session = new EditorSession(chart);
  const { hits, transport, played, tempo } = playerFor(chart, 0);

  transport.position = 0.95;
  tick(hits, session, tempo);
  transport.position = 1.0;
  tick(hits, session, tempo);
  assert.deepEqual(played, [1], "the first note sounds once at audio second 1");

  // Tune the offset to 1000ms while the transport keeps running. The panel keeps
  // the chart position, so audio 1.0 becomes audio 2.0.
  transport.position = 2.0;
  transport.playRevision += 1;
  commitOffset(session, 1000);
  tick(hits, session, tempo);
  assert.deepEqual(played, [1], "no already-heard note may sound again");

  // The next note is chart second 2, now audio second 3.
  transport.position = 2.95;
  tick(hits, session, tempo);
  assert.deepEqual(
    played.slice(1),
    [3],
    `PLAYED=${JSON.stringify(played)} entries=${JSON.stringify(hits.entries.map((e) => e.time))} next=${hits.next}`,
  );
});

test("a round trip back to the same offset replays nothing", () => {
  const chart = chartWith([createNote(3, 2, 0), createNote(3, 4, 0), createNote(3, 6, 0)]);
  const session = new EditorSession(chart);
  const { hits, transport, played, tempo } = playerFor(chart, 0);

  transport.position = 0.95;
  tick(hits, session, tempo);
  transport.position = 1.0;
  tick(hits, session, tempo);
  assert.deepEqual(played, [1]);

  for (const [audio, offsetMs] of [
    [2.0, 1000],
    [1.0, 0],
  ]) {
    transport.position = audio;
    transport.playRevision += 1;
    commitOffset(session, offsetMs);
    tick(hits, session, tempo);
  }

  assert.deepEqual(
    played,
    [1],
    `PLAYED=${JSON.stringify(played)} entries=${JSON.stringify(hits.entries.map((e) => e.time))} next=${hits.next}`,
  );

  transport.position = 1.95;
  tick(hits, session, tempo);
  assert.deepEqual(
    played.slice(1),
    [2],
    `PLAYED=${JSON.stringify(played)} entries=${JSON.stringify(hits.entries.map((e) => e.time))} next=${hits.next}`,
  );
});
