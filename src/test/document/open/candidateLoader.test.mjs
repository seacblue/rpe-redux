/**
 * Candidate-loader regressions: streamed library charts must be complete before
 * the editor replaces the current document.
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
import {
  isPlaceholderLine,
  ChartDocument,
} from "../../../core/global/chart/streaming/chartDocument.ts";
import {
  buildChartIndex,
  chartHeaderFromScan,
} from "../../../core/global/chart/streaming/chartLineSummary.ts";
import { scanChartJson } from "../../../core/global/chart/streaming/chartJsonScanner.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import { createCandidateLoader } from "../../../frontend/screens/editor/workspace/document/open/candidateLoader.ts";

/** Build a streamed chart large enough to exercise the old paged-open branch. */
function largeStreamedDocument() {
  const chart = createChart();
  chart.judgeLineList = Array.from({ length: 10_001 }, (_, index) => {
    const line = createLine(`Line ${index}`);
    line.notes = [createNote(1, 10_000 + index, 0)];
    if (index === 0) {
      line.eventLayers[0].alphaEvents = [createEvent(255, 0, 0, 1)];
    }
    return line;
  });
  const scan = scanChartJson(serializeChart(chart));
  const header = chartHeaderFromScan(scan);
  const index = buildChartIndex(scan, new TempoMap(header.BPMList));
  const document = new ChartDocument({
    header,
    index,
    provider: {
      lineCount: scan.lineRanges.length,
      async readLine(lineIndex) {
        const range = scan.lineRanges[lineIndex];
        return range ? scan.text.slice(range.start, range.end) : undefined;
      },
    },
    maxCachedLines: 1,
  });
  return { chart, document };
}

test("library stream opens only after every line is materialized", async () => {
  const { chart, document } = largeStreamedDocument();
  let installed = chart;
  const updates = [];
  const noop = () => undefined;
  const task = {
    id: 1,
    update: (...args) => updates.push(args),
    complete: noop,
    fail: noop,
  };
  const loadCandidate = createCandidateLoader({
    images: { load: async () => undefined },
    hitSounds: { chart: null, prepare: async () => undefined },
    replaceChart(next) {
      installed = next;
    },
    setLibraryProject: noop,
    currentChart: () => installed,
    currentAssets: () => new Map(),
    currentChartName: () => "large-streamed-chart",
    resolveDesktopSong: () => undefined,
    loadMusic: async () => undefined,
    missingMusic: noop,
    selectLine: noop,
    invalidate: noop,
    waitForFirstRender: async () => undefined,
  });

  await loadCandidate(
    {
      chart: document.chart,
      chartDocument: document,
      name: "large-streamed-chart",
      project: { id: "project-1", name: "large-streamed-chart" },
    },
    new Map(),
    task,
  );

  assert.equal(installed.judgeLineList.length, 10_001);
  const contentUpdates = updates.filter(([stage]) => stage === "content");
  assert.ok(contentUpdates.length > 0);
  const lastContent = contentUpdates.at(-1);
  assert.equal(lastContent[1], lastContent[2]);
  const indexedObjects = document.index.lines.reduce(
    (total, line) => total + line.noteCount + line.eventCount,
    0,
  );
  assert.equal(lastContent[2], indexedObjects);
  assert.ok(indexedObjects > 10_001);
  assert.equal(installed.judgeLineList.some(isPlaceholderLine), false);
  assert.equal(installed.judgeLineList[10_000].notes.length, 1);
});
