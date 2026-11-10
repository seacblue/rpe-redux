/**
 * Paged editor session: line snapshots, undo/redo, and document synchronization
 * without materializing every line.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createLine,
  createNote,
  parseChart,
  serializeChart,
} from "../../../core/global/chart/chart.ts";
import { chartFingerprint } from "../../../core/edit/document/chartRevision.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { serializeChartStream } from "../../../frontend/screens/editor/workspace/document/save/chartSerializeOffThread.ts";
import { scanChartJson } from "../../../core/global/chart/streaming/chartJsonScanner.ts";
import {
  buildChartIndex,
  chartHeaderFromScan,
} from "../../../core/global/chart/streaming/chartLineSummary.ts";
import { ChartDocument } from "../../../core/global/chart/streaming/chartDocument.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";

/** A chart with enough lines that only the selected one is materialized. */
function pagedChart() {
  const chart = createChart();
  chart.judgeLineList = [];
  for (let index = 0; index < 40; index++) {
    const line = createLine(`Line ${index}`);
    line.notes = [createNote(1, index, index / 40)];
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

test("paged session edits one line and undo/redo restores the document", async () => {
  const chart = pagedChart();
  const document = documentFromText(serializeChart(chart));
  const session = EditorSession.fromDocument(document);
  await session.chartDocument.ensureLine(5);
  session.selectLine(5);
  const before = session.chart;
  const beforeFingerprint = session.history.fingerprint();
  const line = document.line(5);
  assert.ok(line);
  const edited = { ...line, notes: [...line.notes, createNote(1, 9, 0.9)] };
  const next = {
    ...before,
    judgeLineList: [...(before.judgeLineList ?? [])],
  };
  next.judgeLineList[5] = edited;

  assert.equal(session.commitChart("edit line", next), true);
  assert.equal(document.line(5), edited);
  assert.equal(session.history.document, document.chart);
  assert.notEqual(session.history.fingerprint(), beforeFingerprint);

  assert.equal(session.history.undo(), true);
  assert.equal(document.line(5), line);
  assert.equal(session.history.fingerprint(), beforeFingerprint);

  assert.equal(session.history.redo(), true);
  assert.equal(document.line(5), edited);
});

test("paged session line insertion and removal stay in the document", async () => {
  const chart = pagedChart();
  const document = documentFromText(serializeChart(chart));
  const session = EditorSession.fromDocument(document);
  const beforeCount = document.lineCount;
  session.addLine();
  assert.equal(document.lineCount, beforeCount + 1);
  assert.equal(session.chart.judgeLineList.length, beforeCount + 1);
  assert.equal(session.history.undo(), true);
  assert.equal(document.lineCount, beforeCount);
  assert.equal(session.chart.judgeLineList.length, beforeCount);
});

test("paged materialization keeps the same fingerprint as the source", async () => {
  const chart = pagedChart();
  const document = documentFromText(serializeChart(chart));
  const materialized = await document.materializeAll();
  assert.equal(chartFingerprint(materialized), chartFingerprint(chart));
});

test("paged save stream round trips after an edit", async () => {
  const chart = pagedChart();
  const document = documentFromText(serializeChart(chart));
  const session = EditorSession.fromDocument(document);
  await document.ensureLine(3);
  const before = session.chart;
  const line = document.line(3);
  const next = { ...before, judgeLineList: [...(before.judgeLineList ?? [])] };
  next.judgeLineList[3] = { ...line, notes: [...line.notes, createNote(1, 8, 0.8)] };
  session.commitChart("edit", next);
  const expected = session.history.fingerprint();
  const chunks = [];
  for await (const chunk of serializeChartStream(session.chart)) {
    chunks.push(chunk);
  }
  const parsed = parseChart(chunks.join(""));
  assert.equal(chartFingerprint(parsed), expected);
});
