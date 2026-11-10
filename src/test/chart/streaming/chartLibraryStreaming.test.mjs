/**
 * Library streaming glue: summary + asset manifest + chart frames become a
 * paged document without a whole-project JSON response.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createLine,
  createNote,
  serializeChart,
} from "../../../core/global/chart/chart.ts";
import { chartFingerprint } from "../../../core/edit/document/chartRevision.ts";
import { scanChartJson } from "../../../core/global/chart/streaming/chartJsonScanner.ts";
import {
  buildChartIndex,
  chartHeaderFromScan,
} from "../../../core/global/chart/streaming/chartLineSummary.ts";
import {
  encodeJsonFrame,
  encodeLineFrame,
} from "../../../core/global/chart/streaming/chartStreamCodec.ts";
import { CHART_FRAME } from "../../../core/global/chart/streaming/chartStreamTypes.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import { openLibraryChartDocument } from "../../../core/global/library/document.ts";
import { saveLibraryDocument } from "../../../core/global/library/save.ts";

/** A small chart with one note. */
function sampleChart() {
  const chart = createChart();
  chart.META.name = "Library stream";
  chart.judgeLineList = [createLine("Line")];
  chart.judgeLineList[0].notes = [createNote(1, 0, 0.5)];
  return chart;
}

test("library chart document opens from summary and chart frames", async () => {
  const chart = sampleChart();
  const text = serializeChart(chart);
  const scan = scanChartJson(text);
  const header = chartHeaderFromScan(scan);
  const tempo = new TempoMap(header.BPMList);
  const index = buildChartIndex(scan, tempo);
  const frames = [
    encodeJsonFrame(CHART_FRAME.header, header),
    encodeJsonFrame(CHART_FRAME.index, index),
    ...scan.lineRanges.map((range, lineIndex) =>
      encodeLineFrame(lineIndex, scan.text.slice(range.start, range.end)),
    ),
    encodeJsonFrame(CHART_FRAME.end, {}),
  ];
  let omittedLines = false;
  const library = {
    async summary() {
      return {
        project: {
          id: "project-1",
          name: "Library stream",
          revision: 3,
          group: "",
          archived: false,
          charter: "",
          composer: "",
          level: "",
          noteCount: 1,
          createdAt: "",
          updatedAt: "",
          size: text.length,
        },
      };
    },
    async assets() {
      return { assets: [] };
    },
    assetUrl() {
      return "";
    },
    async *chartStream(_id, options = {}) {
      omittedLines = options.includeLines === false;
      for (const frame of frames) {
        if (omittedLines && (frame[4] === CHART_FRAME.line || frame[4] === CHART_FRAME.lines)) {
          continue;
        }
        yield frame;
      }
    },
    async chartLines(_id, start, count) {
      const raw = scan.lineRanges
        .slice(start, start + count)
        .map((range) => scan.text.slice(range.start, range.end))
        .join(",");
      return { start, count, raw: `[${raw}]` };
    },
  };
  const opened = await openLibraryChartDocument(library, "project-1");
  assert.equal(opened.project.id, "project-1");
  assert.equal(omittedLines, true);
  assert.equal(opened.chartDocument.lineCount, 1);
  const materialized = await opened.chartDocument.materializeAll();
  assert.equal(chartFingerprint(materialized), chartFingerprint(chart));
});

test("library save uses the streamed commit when chunks are supplied", async () => {
  const calls = [];
  const library = {
    async stageAsset() {
      throw new Error("no uploads expected");
    },
    async commitStream(id, input, chunks) {
      const received = [];
      for await (const chunk of chunks) {
        received.push(chunk);
      }
      calls.push({ id, input, received });
      return { project: { id, revision: 4 } };
    },
    async commit() {
      throw new Error("whole-chart commit must not run");
    },
  };
  const result = await saveLibraryDocument({
    library,
    projectId: "project-1",
    baseRevision: 3,
    chart: {},
    chartJson: "",
    chartChunks: (async function* () {
      yield '{"META":{}';
      yield "}";
    })(),
    name: "Stream save",
    assets: new Map(),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "project-1");
  assert.deepEqual(calls[0].received, ['{"META":{}', "}"]);
  assert.equal(result.revision, 4);
});
