/**
 * Candidate-loader regressions: a streamed chart opens only after every line is
 * materialized, and the music track is ready before the first render.
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
  chart.META.song = "song.mp3";
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

test("library stream installs before audio and completes with every line", async () => {
  const { chart, document } = largeStreamedDocument();
  let installed = chart;
  const order = [];
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
      order.push("replace");
    },
    setLibraryProject: noop,
    currentChart: () => installed,
    currentAssets: () => new Map(),
    currentChartName: () => "large-streamed-chart",
    currentLineIndex: () => 0,
    resolveDesktopSong: () => undefined,
    loadMusic: async () => {
      order.push("audio");
    },
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
    new Map([["song.mp3", new Uint8Array([1, 2, 3])]]),
    task,
  );

  assert.equal(installed, document.chart, "the session keeps the paged facade");
  assert.equal(installed.judgeLineList.length, 10_001);
  assert.deepEqual(
    order,
    ["replace", "audio"],
    "audio starts only after the old owner is released",
  );
  assert.equal(
    installed.judgeLineList.some(isPlaceholderLine),
    false,
    "the open waits for the whole line graph",
  );
  assert.equal(document.unloadedLineCount(), 0, "no page is left for a background pump");
  const contentUpdates = updates.filter(([stage]) => stage === "content");
  assert.ok(contentUpdates.length > 0);
  const lastContent = contentUpdates.at(-1);
  const indexedObjects = document.index.lines.reduce(
    (total, line) => total + line.noteCount + line.eventCount,
    0,
  );
  const progressTotal = indexedObjects + document.index.lines.length;
  assert.equal(lastContent[2], progressTotal, "progress totals stay index-derived");
  assert.equal(lastContent[1], lastContent[2], "the last content tick is the whole chart");
});

test("document load waits for the music track before the first render", async () => {
  const chart = createChart();
  chart.META.song = "song.mp3";
  const assets = new Map([["song.mp3", new Uint8Array([1, 2, 3])]]);
  const audio = deferred();
  let audioLoaded = false;
  let firstRenderSawAudio = false;
  const noop = () => undefined;
  let installed = chart;
  const task = {
    id: 2,
    update: noop,
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
    currentAssets: () => assets,
    currentChartName: () => "chart.json",
    currentLineIndex: () => 0,
    resolveDesktopSong: () => undefined,
    loadMusic: async () => {
      await audio.promise;
      audioLoaded = true;
      return true;
    },
    missingMusic: noop,
    selectLine: noop,
    invalidate: noop,
    waitForFirstRender: async () => {
      firstRenderSawAudio = audioLoaded;
    },
  });

  const loading = loadCandidate({ chart, name: "chart.json" }, assets, task);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(audioLoaded, false);
  assert.equal(firstRenderSawAudio, false);

  audio.resolve();
  await loading;

  assert.equal(audioLoaded, true);
  assert.equal(firstRenderSawAudio, true);
});

/** A promise plus its resolver, for holding the loader at one step. */
function deferred() {
  let resolve = () => {};
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
