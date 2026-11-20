/**
 * A snapshot must never be written from placeholder lines.
 *
 * `registeredChartDocument` used to map a chart object to its document by identity
 * alone. A snapshot is taken as `{ ...chart }`, which is a different object, so a
 * paged facade's copy lost its document and serialized placeholder lines as if
 * they were content. That would store a chart whose paged-out lines were emptied;
 * restoring it would silently destroy the user's work.
 *
 * These tests pin both protections: a shallow copy resolves to its document, and a
 * snapshot refuses to write a chart that still contains placeholders.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
  serializeChart,
} from "../../../core/global/chart/chart.ts";
import { scanChartJson } from "../../../core/global/chart/streaming/chartJsonScanner.ts";
import {
  buildChartIndex,
  chartHeaderFromScan,
} from "../../../core/global/chart/streaming/chartLineSummary.ts";
import {
  ChartDocument,
  isPlaceholderLine,
} from "../../../core/global/chart/streaming/chartDocument.ts";
import { registeredChartDocument } from "../../../core/global/chart/streaming/chartDocumentRegistry.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import { assertSnapshotComplete } from "../../../frontend/screens/editor/workspace/document/save/snapshotIntegrity.ts";

/** A chart with distinct per-line content so a dropped line is detectable. */
function pagedChart() {
  const chart = createChart();
  chart.META.name = "Paged";
  chart.judgeLineList = Array.from({ length: 8 }, (unused, index) => {
    const line = createLine(`Line ${index}`);
    line.notes = [createNote(1, index, 0.5, index), createNote(2, index + 1, 0.25)];
    line.eventLayers = [{ ...line.eventLayers[0], alphaEvents: [createEvent(255, 0, 0, 1)] }];
    line.extended = {};
    return line;
  });
  return chart;
}

/** Build a paged document with a working-set cap small enough to page lines out. */
function pagedDocument(maxCachedLines = 1) {
  const chart = pagedChart();
  const scan = scanChartJson(serializeChart(chart));
  const header = chartHeaderFromScan(scan);
  const tempo = new TempoMap(header.BPMList);
  const document = new ChartDocument({
    header,
    index: buildChartIndex(scan, tempo),
    provider: {
      lineCount: scan.lineRanges.length,
      async readLine(index) {
        const range = scan.lineRanges[index];
        return range ? scan.text.slice(range.start, range.end) : undefined;
      },
    },
    maxCachedLines,
  });
  return { document, chart };
}

test("a shallow copy of a paged facade still resolves to its document", () => {
  const { document } = pagedDocument();
  assert.equal(isPlaceholderLine(document.chart.judgeLineList[0]), true);
  const copied = { ...document.chart };
  assert.equal(registeredChartDocument(document.chart), registeredChartDocument(copied));
  assert.notEqual(registeredChartDocument(copied), undefined);
});

test("a plain chart is never mistaken for a facade", () => {
  const chart = pagedChart();
  assert.equal(registeredChartDocument({ ...chart }), undefined);
});

test("a snapshot refuses a facade that still has placeholder lines", () => {
  const { document } = pagedDocument();
  assert.equal(isPlaceholderLine(document.chart.judgeLineList[0]), true);
  assert.throws(
    () => assertSnapshotComplete(document.chart),
    /incomplete/u,
    "an unmaterialized facade must not be snapshotted",
  );
});

test("a materialized facade passes the completeness check", async () => {
  const { document, chart } = pagedDocument();
  const materialized = await document.materializeAll();
  assertSnapshotComplete(materialized);
  assert.equal(materialized.judgeLineList.length, chart.judgeLineList.length);
  assert.deepEqual(
    materialized.judgeLineList.map((line) => line.notes.length),
    chart.judgeLineList.map((line) => line.notes.length),
  );
});

test("a plain chart passes the completeness check", () => {
  assertSnapshotComplete(pagedChart());
});
