/**
 * Paged documents keep one facade chart object across edits. The preview samples
 * compiled scene runtimes, so an edit must refresh the scene even though the
 * chart identity did not change.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
  parseChart,
  serializeChart,
} from "../../../core/global/chart/chart.ts";
import { chartFingerprint } from "../../../core/edit/document/chartRevision.ts";
import { insertEventAt } from "../../../core/edit/events/eventCommands.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { SceneRuntime } from "../../../core/global/chart/runtime/scene.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import { scanChartJson } from "../../../core/global/chart/streaming/chartJsonScanner.ts";
import {
  buildChartIndex,
  chartHeaderFromScan,
} from "../../../core/global/chart/streaming/chartLineSummary.ts";
import { ChartDocument } from "../../../core/global/chart/streaming/chartDocument.ts";

/** A chart with enough lines that only the selected one is materialized. */
function pagedChart() {
  const chart = createChart();
  chart.judgeLineList = [];
  for (let index = 0; index < 12; index++) {
    const line = createLine(`Line ${index}`);
    line.notes = [createNote(1, index, index / 12)];
    chart.judgeLineList.push(line);
  }
  return chart;
}

/** Build a document over one serialized chart. */
function documentFromText(text) {
  const scan = scanChartJson(text);
  const header = chartHeaderFromScan(scan);
  const tempo = new TempoMap(header.BPMList);
  const index = buildChartIndex(scan, tempo);
  const provider = {
    lineCount: scan.lineRanges.length,
    async readLine(lineIndex) {
      const range = scan.lineRanges[lineIndex];
      return range ? scan.text.slice(range.start, range.end) : undefined;
    },
  };
  return new ChartDocument({ header, index, provider, maxCachedLines: 2 });
}

/** Open a paged session with one line materialized and selected. */
async function pagedSession() {
  const chart = pagedChart();
  const document = documentFromText(serializeChart(chart));
  const session = EditorSession.fromDocument(document);
  await document.ensureLine(2);
  session.selectLine(2);
  return { chart, document, session, tempo: new TempoMap(chart.BPMList) };
}

test("paged note insertion refreshes the compiled scene without a new chart", async () => {
  const { session, tempo } = await pagedSession();
  const scene = new SceneRuntime();
  scene.compile(session.chart, tempo);
  const before = scene.lines[2].notes.length;
  const facade = session.chart;
  const revision = session.contentRevision;

  assert.equal(session.insertNotesAt(2, [createNote(1, 4, 0)]), true);

  assert.equal(session.chart, facade, "paged commits keep the facade identity");
  assert.notEqual(session.contentRevision, revision, "a content commit bumps the revision");
  assert.deepEqual(session.lastChangedLineIndexes, [2]);

  // The preview may only have the chart and tempo; the scene must still find
  // the changed line by comparing the line snapshot it compiled last time.
  scene.compile(session.chart, tempo);
  assert.equal(scene.lines[2].notes.length, before + 1);
});

test("paged undo refreshes the scene and reports the restored line", async () => {
  const { session, tempo } = await pagedSession();
  const scene = new SceneRuntime();
  scene.compile(session.chart, tempo);
  const before = scene.lines[2].notes.length;

  session.insertNotesAt(2, [createNote(1, 4, 0)]);
  scene.compile(session.chart, tempo);
  assert.equal(scene.lines[2].notes.length, before + 1);

  assert.equal(session.travel("undo"), true);
  assert.deepEqual(
    session.lastChangedLineIndexes,
    [2],
    "the facade cannot reveal its own in-place undo, so the snapshot must",
  );

  scene.compile(session.chart, tempo);
  assert.equal(scene.lines[2].notes.length, before);
});

test("paged event placement refreshes the compiled line transform", async () => {
  const { session, tempo } = await pagedSession();
  const scene = new SceneRuntime();
  scene.compile(session.chart, tempo);
  assert.equal(scene.sample(7)[2].x, 0, "the default moveX event holds at zero");

  session.eventLayer = 0;
  insertEventAt(session, 2, "moveXEvents", createEvent(100, 100, 10, 20), 0);
  scene.compile(session.chart, tempo, undefined, [2]);

  assert.equal(scene.sample(7)[2].x, 100, "the placed event reaches the scene");
});

test("paged line materialization bumps the session content revision", async () => {
  const { document, session, tempo } = await pagedSession();
  const scene = new SceneRuntime();
  scene.compile(session.chart, tempo);
  assert.equal(scene.lines[7], undefined, "the unloaded line has no runtime");

  const revision = session.contentRevision;
  await document.ensureLine(7);

  assert.notEqual(
    session.contentRevision,
    revision,
    "paging a line into the facade changes sampleable content",
  );
  scene.compile(session.chart, tempo);
  assert.ok(scene.lines[7], "the materialized line gains a runtime");
});

test("paged note placement keeps the incremental fingerprint exact", async () => {
  const { document, session } = await pagedSession();

  session.insertNotesAt(2, [createNote(1, 4, 0)]);
  session.insertNotesAt(2, [createNote(2, 5, 0, 6)]);
  session.insertNotesAt(0, [createNote(1, 1, 0)]);

  const materialized = await document.materializeAll();
  assert.equal(
    document.fingerprint(),
    chartFingerprint(parseChart(serializeChart(materialized))),
    "the seeded line digest must equal a cold content walk",
  );
});

test("selection-only history entries do not bump the content revision", async () => {
  const { session } = await pagedSession();
  const contentRevision = session.history.contentRevision;
  const historyRevision = session.history.revision;
  const before = session.selectionState();

  session.selection = new Set([0]);
  assert.equal(session.recordSelection("select", before, false), true);

  assert.equal(session.history.contentRevision, contentRevision);
  assert.notEqual(session.history.revision, historyRevision);
});
