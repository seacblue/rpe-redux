/**
 * Library import of a streamed document must serialize every line from the
 * document source instead of storing the placeholder lines the facade exposes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createLine,
  createNote,
  serializeChart,
} from "../../../core/global/chart/chart.ts";
import { ChartDocument } from "../../../core/global/chart/streaming/chartDocument.ts";
import { registerChartDocument } from "../../../core/global/chart/streaming/chartDocumentRegistry.ts";
import { scanChartJson } from "../../../core/global/chart/streaming/chartJsonScanner.ts";
import {
  buildChartIndex,
  chartHeaderFromScan,
} from "../../../core/global/chart/streaming/chartLineSummary.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import { importChartToLibrary } from "../../../core/global/library/import.ts";

/** A small chart whose line carries one note. */
function sampleChart() {
  const chart = createChart();
  chart.META.name = "Streamed import";
  chart.judgeLineList = [createLine("Line")];
  chart.judgeLineList[0].notes = [createNote(1, 0, 0.5)];
  return chart;
}

/** A library stub recording the committed chart text. */
function recordingLibrary(commits) {
  return {
    async createRaw() {
      return { project: { id: "project-1", revision: 1 } };
    },
    async stageAsset() {
      throw new Error("no asset uploads expected");
    },
    async commit(id, input) {
      commits.push(input.chartJson);
      return { project: { id, revision: 2 } };
    },
  };
}

test("a streamed chart import stores its lines instead of facade placeholders", async () => {
  const chart = sampleChart();
  const text = serializeChart(chart);
  const scan = scanChartJson(text);
  const header = chartHeaderFromScan(scan);
  const index = buildChartIndex(scan, new TempoMap(header.BPMList));
  const document = new ChartDocument({
    header,
    index,
    provider: {
      lineCount: index.lines.length,
      async readLine(lineIndex) {
        const range = scan.lineRanges[lineIndex];
        return range ? scan.text.slice(range.start, range.end) : undefined;
      },
    },
  });
  const commits = [];
  const result = await importChartToLibrary({
    library: recordingLibrary(commits),
    chart: document.chart,
    name: "Streamed import",
    assets: new Map(),
  });
  assert.equal(result.projectId, "project-1");
  assert.equal(commits.length, 1);
  const imported = JSON.parse(commits[0]);
  assert.equal(imported.judgeLineList.length, 1);
  assert.equal(imported.judgeLineList[0].notes.length, 1);
  assert.equal(imported.judgeLineList[0].notes[0].type, 1);
  // The facade keeps placeholder lines; only the document serializer can see
  // the real notes, which is why serializing the facade directly lost them.
  assert.equal(document.chart.judgeLineList[0].notes.length, 0);
});

test("a large chart import uses the streamed library commit", async () => {
  const chartJson = `{"META":{"name":"${"x".repeat(48 * 1024 * 1024)}"}}`;
  let createRawCalled = false;
  let commitCalled = false;
  let received = "";
  const library = {
    async createRaw() {
      createRawCalled = true;
      return { project: { id: "large-project", revision: 1 } };
    },
    async stageAsset() {
      throw new Error("no asset uploads expected");
    },
    async commit() {
      commitCalled = true;
      throw new Error("large imports must not use the JSON body commit");
    },
    async remove() {
      return { deleted: true };
    },
    async commitStream(_id, _input, chunks) {
      for await (const chunk of chunks) {
        received += chunk;
      }
      return { project: { id: "large-project", revision: 2 } };
    },
  };

  const result = await importChartToLibrary({
    library,
    chart: {},
    chartJson,
    name: "Large import",
    assets: new Map(),
  });

  assert.equal(result.projectId, "large-project");
  assert.equal(createRawCalled, true);
  assert.equal(commitCalled, false);
  assert.equal(received, chartJson);
});

test("a large paged chart streams from the document without joining all lines", async () => {
  const chart = {};
  registerChartDocument(chart, {
    index: { lines: [{ byteLength: 49 * 1024 * 1024 }] },
    fingerprint: () => "large-document",
    materializeAll: async () => sampleChart(),
    async serialize(sink) {
      await sink('{"judgeLineList":[]}');
    },
  });
  let committed = "";
  let usedInlineCommit = false;
  const library = {
    async createRaw() {
      return { project: { id: "paged-project", revision: 1 } };
    },
    async stageAsset() {
      throw new Error("no asset uploads expected");
    },
    async commit() {
      usedInlineCommit = true;
      throw new Error("paged imports must stream");
    },
    async commitStream(_id, _input, chunks) {
      for await (const chunk of chunks) {
        committed += chunk;
      }
      return { project: { id: "paged-project", revision: 2 } };
    },
  };

  const result = await importChartToLibrary({
    library,
    chart,
    name: "Large paged import",
    assets: new Map(),
  });

  assert.equal(result.projectId, "paged-project");
  assert.equal(usedInlineCommit, false);
  assert.equal(committed, '{"judgeLineList":[]}');
});
