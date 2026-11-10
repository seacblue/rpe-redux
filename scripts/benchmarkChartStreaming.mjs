/**
 * Chart streaming benchmark: compares whole-chart parsing/serialization with
 * the scanner + paged document path. Run with:
 *
 *   node --expose-gc scripts/benchmarkChartStreaming.mjs --lines 2000 --notes 20
 *
 * The script is intentionally outside the unit suite so the default gate stays
 * fast; the committed streaming tests cover correctness, this covers scale.
 */
import { performance } from "node:perf_hooks";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
  parseChart,
  serializeChart,
} from "../src/core/global/chart/chart.ts";
import { chartFingerprint } from "../src/core/edit/document/chartRevision.ts";
import { scanChartJson } from "../src/core/global/chart/streaming/chartJsonScanner.ts";
import {
  buildChartIndex,
  chartHeaderFromScan,
} from "../src/core/global/chart/streaming/chartLineSummary.ts";
import { ChartDocument } from "../src/core/global/chart/streaming/chartDocument.ts";
import { TempoMap } from "../src/core/global/chart/timing/tempo.ts";

/** Parse `--name value` options. */
function options() {
  const values = { lines: 2000, notes: 20, time: 0, visibleTime: 999999 };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
      ?.replace(/^--/, "")
      .replace(/-([a-z])/g, (unused, letter) => letter.toUpperCase());
    const value = Number(args[index + 1]);
    if (key in values && Number.isFinite(value)) {
      values[key] = value;
    }
  }
  return values;
}

/** Milliseconds with one decimal. */
function ms(start) {
  return Math.round((performance.now() - start) * 10) / 10;
}

/** MiB with one decimal. */
function mib(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

/** Read current heap and RSS after an optional collection. */
function memory() {
  globalThis.gc?.();
  const usage = process.memoryUsage();
  return { heap: mib(usage.heapUsed), rss: mib(usage.rss) };
}

/** Generate a chart whose notes span the requested chart time. */
function buildChart(lineCount, notesPerLine, visibleTime) {
  const chart = createChart();
  chart.META.name = "streaming benchmark";
  chart.judgeLineList = [];
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
    const line = createLine(`Line ${lineIndex}`);
    line.notes = [];
    line.eventLayers[0].alphaEvents = [createEvent(255, 0, 0, 4)];
    for (let noteIndex = 0; noteIndex < notesPerLine; noteIndex++) {
      const beat = (lineIndex * notesPerLine + noteIndex) / Math.max(1, notesPerLine);
      const note = createNote(1, beat, (noteIndex % 100) / 100);
      note.visibleTime = visibleTime;
      line.notes.push(note);
    }
    chart.judgeLineList.push(line);
  }
  return chart;
}

/** Run the comparison for one size. */
async function run() {
  const { lines, notes, time, visibleTime } = options();
  const chart = buildChart(lines, notes, visibleTime);
  const text = serializeChart(chart);
  const bytes = Buffer.byteLength(text);
  const duration = lines * 0.5;
  const queryTime = time > 0 ? time : duration / 2;
  console.log(
    `\nChart: ${lines} lines, ${lines * notes} notes, ${mib(bytes)} MiB pretty JSON, visibleTime ${visibleTime}`,
  );

  let start = performance.now();
  const whole = parseChart(text);
  const wholeMs = ms(start);
  const wholeMemory = memory();
  console.log(
    `whole parseChart            ${wholeMs} ms  heap ${wholeMemory.heap} MiB  rss ${wholeMemory.rss} MiB`,
  );

  start = performance.now();
  const scan = scanChartJson(text);
  const header = chartHeaderFromScan(scan);
  const tempo = new TempoMap(header.BPMList);
  const index = buildChartIndex(scan, tempo);
  const scanMs = ms(start);
  const scanMemory = memory();
  console.log(
    `scan + line index           ${scanMs} ms  heap ${scanMemory.heap} MiB  rss ${scanMemory.rss} MiB`,
  );

  const provider = {
    lineCount: scan.lineRanges.length,
    async readLine(lineIndex) {
      const range = scan.lineRanges[lineIndex];
      return range ? scan.text.slice(range.start, range.end) : undefined;
    },
  };
  const document = new ChartDocument({ header, index, provider, maxCachedLines: 256 });

  start = performance.now();
  const materialized = await document.materializeAll();
  const materializeMs = ms(start);
  const materializeMemory = memory();
  console.log(
    `document materializeAll     ${materializeMs} ms  heap ${materializeMemory.heap} MiB  rss ${materializeMemory.rss} MiB`,
  );

  start = performance.now();
  const loaded = await document.ensureTime(queryTime, 5, { maxLines: 20000 });
  const pagedMs = ms(start);
  console.log(
    `paged ensureTime(${queryTime}s)      ${pagedMs} ms  loaded ${loaded.length}/${document.lineCount} lines`,
  );

  start = performance.now();
  let output = "";
  await document.serialize((chunk) => {
    output += chunk;
  });
  const streamSaveMs = ms(start);
  console.log(
    `document serialize          ${streamSaveMs} ms  output ${mib(Buffer.byteLength(output))} MiB`,
  );

  const sameFingerprint =
    chartFingerprint(whole) === chartFingerprint(materialized) &&
    chartFingerprint(whole) === chartFingerprint(parseChart(output));
  console.log(`fingerprints equal          ${sameFingerprint ? "yes" : "NO"}`);
  console.log(
    `speedup vs whole parse      ${wholeMs > 0 ? (wholeMs / Math.max(0.1, scanMs)).toFixed(2) : "-"}x (scan/index only)`,
  );
}

await run();
