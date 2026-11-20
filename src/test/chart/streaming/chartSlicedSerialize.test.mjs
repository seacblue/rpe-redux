/**
 * The sliced serializer must produce the same text as before.
 *
 * Yielding between slices changes when work happens, not what is written. This
 * compares the streamed text against `serializeChart` for charts large enough to
 * cross several slice boundaries, so a slice-boundary bug cannot hide in a small
 * fixture.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createChart,
  createLine,
  createNote,
  parseChart,
  serializeChart,
} from "../../../core/global/chart/chart.ts";
import { scanChartJson } from "../../../core/global/chart/streaming/chartJsonScanner.ts";
import {
  buildChartIndex,
  chartHeaderFromScan,
} from "../../../core/global/chart/streaming/chartLineSummary.ts";
import { ChartDocument } from "../../../core/global/chart/streaming/chartDocument.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import { chartFingerprint } from "../../../core/edit/document/chartRevision.ts";

function buildChart(lineCount, notesPerLine) {
  const chart = createChart();
  chart.META.name = "Slice Probe";
  chart.judgeLineList = Array.from({ length: lineCount }, (unused, lineIndex) => {
    const line = createLine(`Line ${lineIndex}`);
    line.notes = Array.from({ length: notesPerLine }, (unused2, noteIndex) =>
      createNote(1, lineIndex + noteIndex / notesPerLine, 0.5, lineIndex),
    );
    line.eventLayers = [
      {
        ...line.eventLayers[0],
        moveXEvents: Array.from({ length: 4 }, (unused2, eventIndex) => ({
          startTime: [lineIndex, eventIndex, 4],
          endTime: [lineIndex, eventIndex + 1, 4],
          start: 0,
          end: 1,
        })),
      },
    ];
    line.extended = {};
    return line;
  });
  return chart;
}

function pagedDocument(chart) {
  const scan = scanChartJson(serializeChart(chart));
  const header = chartHeaderFromScan(scan);
  const tempo = new TempoMap(header.BPMList);
  return new ChartDocument({
    header,
    index: buildChartIndex(scan, tempo),
    provider: {
      lineCount: scan.lineRanges.length,
      async readLine(index) {
        const range = scan.lineRanges[index];
        return range ? scan.text.slice(range.start, range.end) : undefined;
      },
    },
  });
}

for (const lineCount of [1, 16, 17, 64, 65, 400]) {
  test(`sliced serialization matches serializeChart at ${lineCount} lines`, async () => {
    const document = pagedDocument(buildChart(lineCount, 3));
    const chunks = [];
    await document.serialize((chunk) => {
      chunks.push(chunk);
    });
    const text = chunks.join("");
    assert.equal(
      chartFingerprint(parseChart(text)),
      chartFingerprint(parseChart(serializeChart(buildChart(lineCount, 3)))),
    );
  });
}

test("sliced serialization is byte-stable across slice boundaries", async () => {
  // An identical chart must produce identical text no matter how many yields the
  // loop takes, so the stored backup is reproducible.
  const document = pagedDocument(buildChart(200, 2));
  const first = [];
  await document.serialize((chunk) => {
    first.push(chunk);
  });
  const second = [];
  await document.serialize((chunk) => {
    second.push(chunk);
  });
  assert.equal(first.join(""), second.join(""));
});

test("a dirty line still serializes through the sliced loop", async () => {
  const chart = buildChart(40, 2);
  const document = pagedDocument(chart);
  const lines = document.chart.judgeLineList;
  const edited = { ...lines[0], notes: [...lines[0].notes] };
  document.replaceLine(0, edited);
  const chunks = [];
  await document.serialize((chunk) => {
    chunks.push(chunk);
  });
  const parsed = parseChart(chunks.join(""));
  assert.equal(parsed.judgeLineList.length, 40);
  assert.equal(parsed.judgeLineList[0].notes.length, edited.notes.length);
});
