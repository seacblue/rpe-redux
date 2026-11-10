/**
 * Streaming chart document tests: scanner ranges, line summaries, paged loading,
 * serialization round trips, and content fingerprints that ignore editor ids.
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
import { scanChartJson } from "../../../core/global/chart/streaming/chartJsonScanner.ts";
import {
  buildChartIndex,
  chartHeaderFromScan,
  summarizeChartLine,
} from "../../../core/global/chart/streaming/chartLineSummary.ts";
import {
  ChartDocument,
  ChartPagingLimitError,
  isPlaceholderLine,
} from "../../../core/global/chart/streaming/chartDocument.ts";
import { LINE_FLAG_UNBOUNDED } from "../../../core/global/chart/streaming/chartStreamTypes.ts";
import { CHART_FRAME } from "../../../core/global/chart/streaming/chartStreamTypes.ts";
import {
  ChartFrameDecoder,
  encodeJsonFrame,
  encodeLineFrame,
  encodeLinesFrame,
} from "../../../core/global/chart/streaming/chartStreamCodec.ts";
import {
  parseChartFrames,
  parseChartByteStream,
} from "../../../core/global/chart/streaming/chartFrameParser.ts";
import { openChartStreamOffThread } from "../../../frontend/screens/editor/workspace/document/open/chartStreamOffThread.ts";
import { serializeChartStream } from "../../../frontend/screens/editor/workspace/document/save/chartSerializeOffThread.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";

/** A chart with a static line, a normal line, and tricky speed lines. */
function trickyChart() {
  const chart = createChart();
  chart.META.name = "Streaming";
  chart.judgeLineList = [];

  const staticLine = createLine("Static");
  staticLine.notes = [];
  staticLine.eventLayers = [];
  staticLine.extended = {};
  chart.judgeLineList.push(staticLine);

  const normal = createLine("Normal");
  normal.notes = [createNote(1, 0, 0.25), createNote(2, 1, 0.5, 2)];
  normal.eventLayers[0].alphaEvents = [createEvent(255, 0, 0, 1)];
  normal.eventLayers[0].moveXEvents = [createEvent(0, 1, 0, 2)];
  chart.judgeLineList.push(normal);

  const zeroSpeed = createLine("Zero speed");
  zeroSpeed.notes = [createNote(1, 0, 0.1), createNote(1, 2, 0.2)];
  zeroSpeed.notes[0].speed = 0;
  zeroSpeed.eventLayers[0].alphaEvents = [createEvent(255, 255, 0, 4)];
  chart.judgeLineList.push(zeroSpeed);

  const negativeSpeed = createLine("Negative speed");
  negativeSpeed.notes = [createNote(3, 0, 0.7), createNote(3, 1, 0.8)];
  negativeSpeed.notes[0].speed = -1;
  negativeSpeed.eventLayers[0].speedEvents = [createEvent(-1, -1, 0, 4)];
  negativeSpeed.eventLayers[0].alphaEvents = [createEvent(255, 255, 0, 4)];
  chart.judgeLineList.push(negativeSpeed);

  return chart;
}

/** A raw-line provider over one scanned text. */
function providerFromScan(scan) {
  return {
    lineCount: scan.lineRanges.length,
    async readLine(index) {
      const range = scan.lineRanges[index];
      return range ? scan.text.slice(range.start, range.end) : undefined;
    },
  };
}

/** Build a paged document over the scanned chart. */
function documentFromScan(scan, options = {}) {
  const header = chartHeaderFromScan(scan);
  const tempo = new TempoMap(header.BPMList);
  const index = buildChartIndex(scan, tempo);
  return new ChartDocument({
    header,
    index,
    provider: providerFromScan(scan),
    ...options,
  });
}

/** Decode encoded frames into the frame objects the parser consumes. */
function framesOf(encoded) {
  const decoder = new ChartFrameDecoder();
  return encoded.flatMap((frame) => decoder.push(frame));
}

test("scanner reads header and line ranges without parsing line objects", () => {
  const chart = trickyChart();
  const text = serializeChart(chart);
  const scan = scanChartJson(text);
  assert.equal(scan.lineRanges.length, 4);
  assert.equal(scan.header.META.name, "Streaming");
  assert.ok(Array.isArray(scan.header.BPMList));
  assert.equal(scan.keyOrder.includes("judgeLineList"), true);
  for (const range of scan.lineRanges) {
    assert.ok(range.end > range.start);
  }
});

test("scanner accepts judgeLineList before META", () => {
  const chart = trickyChart();
  const line = JSON.stringify(chart.judgeLineList[0]);
  const text = `{"judgeLineList":[${line}],"META":{"name":"Late"},"BPMList":[{"bpm":120,"startTime":[0,0,1]}]}`;
  const scan = scanChartJson(text);
  assert.equal(scan.lineRanges.length, 1);
  assert.equal(scan.header.META.name, "Late");
});

test("summaries flag unbounded static and non-positive-speed lines", () => {
  const chart = trickyChart();
  const tempo = new TempoMap(chart.BPMList);
  const staticSummary = summarizeChartLine(chart.judgeLineList[0], 0, tempo);
  assert.ok(staticSummary.flags & LINE_FLAG_UNBOUNDED);
  const normalSummary = summarizeChartLine(chart.judgeLineList[1], 1, tempo);
  assert.equal(normalSummary.noteCount, 2);
  assert.equal(normalSummary.startSeconds, 0);
  assert.equal(normalSummary.endSeconds, 1);
  const zeroSummary = summarizeChartLine(chart.judgeLineList[2], 2, tempo);
  assert.ok(zeroSummary.flags & LINE_FLAG_UNBOUNDED);
  const negativeSummary = summarizeChartLine(chart.judgeLineList[3], 3, tempo);
  assert.ok(negativeSummary.flags & LINE_FLAG_UNBOUNDED);
});

test("paged document materializes to the same content fingerprint", async () => {
  const chart = trickyChart();
  const text = serializeChart(chart);
  const scan = scanChartJson(text);
  const document = documentFromScan(scan, { maxCachedLines: 1 });
  assert.equal(isPlaceholderLine(document.chart.judgeLineList[0]), true);
  await document.ensureLine(1);
  assert.equal(isPlaceholderLine(document.chart.judgeLineList[1]), false);
  const materialized = await document.materializeAll();
  assert.equal(materialized.judgeLineList.some(isPlaceholderLine), false);
  assert.equal(chartFingerprint(materialized), chartFingerprint(chart));
  assert.equal(await document.fingerprint(), chartFingerprint(chart));
});

test("editor-only ids do not change the content fingerprint", () => {
  const chart = trickyChart();
  const clone = structuredClone(chart);
  for (const line of clone.judgeLineList) {
    line.id = "00000000-0000-7000-8000-000000000000";
    for (const note of line.notes) {
      note.id = "00000000-0000-7000-8000-000000000001";
    }
  }
  assert.equal(chartFingerprint(clone), chartFingerprint(chart));
});

test("paged serialization round trips through parseChart", async () => {
  const chart = trickyChart();
  const text = serializeChart(chart);
  const scan = scanChartJson(text);
  const document = documentFromScan(scan, { maxCachedLines: 1 });
  const chunks = [];
  await document.serialize((chunk) => {
    chunks.push(chunk);
  });
  const parsed = parseChart(chunks.join(""));
  assert.equal(chartFingerprint(parsed), chartFingerprint(chart));
});

test("ensureTime loads candidates and rejects an explicit cap", async () => {
  const chart = trickyChart();
  const text = serializeChart(chart);
  const scan = scanChartJson(text);
  const document = documentFromScan(scan);
  await assert.rejects(
    () => document.ensureTime(0, 1, { maxLines: 1 }),
    (error) => error instanceof ChartPagingLimitError,
  );
  const loaded = await document.ensureTime(0, 1);
  assert.ok(loaded.length >= 2);
});

test("ensureTime uses disjoint intervals instead of one min/max span", async () => {
  const chart = createChart();
  chart.judgeLineList = [];
  const early = createLine("Early");
  early.notes = [createNote(1, 0, 0.1)];
  early.notes[0].visibleTime = 1;
  early.eventLayers[0].alphaEvents = [createEvent(255, 0, 0, 2)];
  chart.judgeLineList.push(early);
  const late = createLine("Late");
  late.notes = [createNote(1, 100, 0.2)];
  late.notes[0].visibleTime = 1;
  late.eventLayers[0].alphaEvents = [createEvent(255, 0, 0, 2)];
  chart.judgeLineList.push(late);
  const text = serializeChart(chart);
  const scan = scanChartJson(text);
  const document = documentFromScan(scan);
  const loaded = await document.ensureTime(50, 2);
  assert.deepEqual(loaded, [1]);
});

test("frame parser materializes the same content as the source chart", async () => {
  const chart = trickyChart();
  const text = serializeChart(chart);
  const scan = scanChartJson(text);
  const header = chartHeaderFromScan(scan);
  const tempo = new TempoMap(header.BPMList);
  const index = buildChartIndex(scan, tempo);
  const frames = [
    encodeJsonFrame(CHART_FRAME.header, header),
    encodeJsonFrame(CHART_FRAME.index, index),
  ];
  for (const [lineIndex, range] of scan.lineRanges.entries()) {
    frames.push(encodeLineFrame(lineIndex, scan.text.slice(range.start, range.end)));
  }
  frames.push(encodeJsonFrame(CHART_FRAME.end, { bytes: text.length }));
  const parsed = await parseChartFrames(framesOf(frames), { materialize: true });
  assert.ok(parsed.chart);
  assert.equal(chartFingerprint(parsed.chart), chartFingerprint(chart));
});

test("frame parser accepts a line batch and serves paged lines", async () => {
  const chart = trickyChart();
  const text = serializeChart(chart);
  const scan = scanChartJson(text);
  const header = chartHeaderFromScan(scan);
  const tempo = new TempoMap(header.BPMList);
  const index = buildChartIndex(scan, tempo);
  const rawLines = scan.lineRanges.map((range) => scan.text.slice(range.start, range.end));
  const frames = [
    encodeJsonFrame(CHART_FRAME.header, header),
    encodeJsonFrame(CHART_FRAME.index, index),
    encodeLinesFrame(0, rawLines.length, `[${rawLines.join(",")}]`),
    encodeJsonFrame(CHART_FRAME.end, {}),
  ];
  const parsed = await parseChartFrames(framesOf(frames));
  assert.equal(parsed.chart, null);
  const line = await parsed.chartDocument.ensureLine(2);
  assert.equal(line.Name, "Zero speed");
  assert.equal(isPlaceholderLine(parsed.chartDocument.chart.judgeLineList[2]), false);
});

test("off-thread opener falls back to in-process scanning without workers", async () => {
  const chart = trickyChart();
  const text = serializeChart(chart);
  const bytes = new TextEncoder().encode(text).buffer;
  const opened = await openChartStreamOffThread(bytes, "test.json");
  try {
    const materialized = await opened.document.materializeAll();
    assert.equal(chartFingerprint(materialized), chartFingerprint(chart));
  } finally {
    opened.dispose();
  }
});

test("document-backed save stream round trips through parseChart", async () => {
  const chart = trickyChart();
  const text = serializeChart(chart);
  const scan = scanChartJson(text);
  const document = documentFromScan(scan);
  const chunks = [];
  for await (const chunk of serializeChartStream(document.chart)) {
    chunks.push(chunk);
  }
  const parsed = parseChart(chunks.join(""));
  assert.equal(chartFingerprint(parsed), chartFingerprint(chart));
});

test("byte stream parser reassembles frames split at arbitrary boundaries", async () => {
  const chart = trickyChart();
  const text = serializeChart(chart);
  const scan = scanChartJson(text);
  const header = chartHeaderFromScan(scan);
  const tempo = new TempoMap(header.BPMList);
  const index = buildChartIndex(scan, tempo);
  const encoded = [
    encodeJsonFrame(CHART_FRAME.header, header),
    encodeJsonFrame(CHART_FRAME.index, index),
    ...scan.lineRanges.map((range, lineIndex) =>
      encodeLineFrame(lineIndex, scan.text.slice(range.start, range.end)),
    ),
    encodeJsonFrame(CHART_FRAME.end, {}),
  ];
  const total = encoded.reduce((sum, frame) => sum + frame.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const frame of encoded) {
    bytes.set(frame, offset);
    offset += frame.length;
  }
  async function* chunks() {
    for (let start = 0; start < bytes.length; start += 7) {
      yield bytes.slice(start, start + 7);
    }
  }
  const parsed = await parseChartByteStream(chunks(), { materialize: true });
  assert.ok(parsed.chart);
  assert.equal(chartFingerprint(parsed.chart), chartFingerprint(chart));
});
