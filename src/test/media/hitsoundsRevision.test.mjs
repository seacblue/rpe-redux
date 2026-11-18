/** Hit sounds follow a paged chart document's content revision, not only chart identity. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createNote } from "../../core/global/chart/chart.ts";
import { ChartDocument } from "../../core/global/chart/streaming/chartDocument.ts";
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
function transportStub() {
  return {
    playing: true,
    clockReady: true,
    playRevision: 1,
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

/** A paged session over one chart line, sharing the facade the editor sees. */
function pagedSession(chart) {
  const document = ChartDocument.fromChart(chart);
  const session = EditorSession.fromDocument(document);
  const transport = transportStub();
  const hits = new HitSounds(transport);
  hits.setProject(session.chart, {}, "revision-fixture");
  hits.buffers.set("tap", {});
  return { document, session, hits, tempo: new TempoMap(chart.BPMList), transport };
}

test("a paged facade rebuilds the trigger list when its content revision changes", () => {
  const chart = chartWith([createNote(1, 2, 0), createNote(1, 4, 0)]);
  const { document, session, hits, tempo } = pagedSession(chart);

  hits.tick(session.chart, tempo, null, session.contentRevision);
  assert.deepEqual(
    hits.entries.map((entry) => entry.time),
    [1, 2],
  );

  const line = document.line(0);
  document.replaceLine(0, { ...line, notes: [line.notes[0]] });
  assert.equal(session.chart, document.chart, "the facade chart identity must stay stable");
  assert.notEqual(session.contentRevision, 0, "an edit changes the content revision");

  hits.tick(session.chart, tempo, null, session.contentRevision);
  assert.deepEqual(
    hits.entries.map((entry) => entry.time),
    [1],
    "the deleted note must leave the trigger list",
  );
});

test("moving a note updates its trigger time on the same facade", () => {
  const chart = chartWith([createNote(1, 2, 0)]);
  const { document, session, hits, tempo } = pagedSession(chart);

  hits.tick(session.chart, tempo, null, session.contentRevision);
  assert.deepEqual(
    hits.entries.map((entry) => entry.time),
    [1],
  );

  const line = document.line(0);
  document.replaceLine(0, { ...line, notes: [{ ...line.notes[0], startTime: [8, 0, 1] }] });

  hits.tick(session.chart, tempo, null, session.contentRevision);
  assert.deepEqual(
    hits.entries.map((entry) => entry.time),
    [4],
    "the trigger must follow the moved note",
  );
});

test("paging changes rebuild without stopping or replaying queued voices", () => {
  const chart = chartWith([createNote(1, 2, 0)]);
  const { session, hits, tempo, transport } = pagedSession(chart);
  const played = [];
  hits.playEntry = (entry) => played.push(entry.time);
  transport.audioTime = 0.95;

  hits.tick(session.chart, tempo, null, 1, 0);
  assert.deepEqual(played, [1], "the note enters the look-ahead window once");
  played.length = 0;

  const stop = hits.stop.bind(hits);
  let stops = 0;
  hits.stop = () => {
    stops += 1;
    stop();
  };

  // Line materialization bumps the document revision but not the history revision.
  hits.tick(session.chart, tempo, null, 2, 0);
  assert.equal(stops, 0, "paging must not cut voices that are already scheduled");
  assert.deepEqual(played, [], "a queued trigger must not be scheduled twice");

  // A history commit can move or delete a note whose voice is already queued.
  hits.tick(session.chart, tempo, null, 3, 1);
  assert.ok(stops > 0, "an edit must stop voices that the old list scheduled");
});
