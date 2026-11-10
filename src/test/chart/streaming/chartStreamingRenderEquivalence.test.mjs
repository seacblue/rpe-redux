/**
 * Rendering-data equivalence for paged charts: for every sampled time, a scene
 * built from only the lines a paging window loaded must match the full scene for
 * line state and visible note entries. Covers static lines, line events, and
 * zero/low/negative note speeds without special-casing any speed value.
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
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import { SceneRuntime } from "../../../core/global/chart/runtime/scene.ts";
import { scanChartJson } from "../../../core/global/chart/streaming/chartJsonScanner.ts";
import {
  buildChartIndex,
  chartHeaderFromScan,
} from "../../../core/global/chart/streaming/chartLineSummary.ts";
import { ChartDocument } from "../../../core/global/chart/streaming/chartDocument.ts";

/** A chart exercising every speed and judge-line-event edge that affects time. */
function renderChart() {
  const chart = createChart();
  chart.META.name = "Render equivalence";
  chart.judgeLineList = [];

  const staticLine = createLine("Static");
  staticLine.notes = [];
  staticLine.eventLayers = [];
  staticLine.extended = {};
  chart.judgeLineList.push(staticLine);

  const normal = createLine("Normal");
  normal.notes = [createNote(1, 0, 0.2), createNote(2, 1, 0.4, 2)];
  normal.eventLayers[0].alphaEvents = [createEvent(255, 0, 0, 1)];
  normal.eventLayers[0].moveXEvents = [createEvent(0, 1, 0, 2)];
  normal.eventLayers[0].rotateEvents = [createEvent(0, 45, 0, 2)];
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

  const lowSpeed = createLine("Low speed");
  lowSpeed.notes = [createNote(1, 0, 0.3), createNote(1, 3, 0.4)];
  lowSpeed.notes[0].speed = 0.01;
  lowSpeed.eventLayers[0].alphaEvents = [createEvent(255, 0, 0, 4)];
  chart.judgeLineList.push(lowSpeed);

  const parent = createLine("Parent");
  parent.notes = [];
  parent.eventLayers[0].moveXEvents = [createEvent(0, 100, 0, 4)];
  parent.eventLayers[0].rotateEvents = [createEvent(0, 30, 0, 4)];
  parent.eventLayers[0].alphaEvents = [createEvent(255, 0, 0, 4)];
  chart.judgeLineList.push(parent);

  const child = createLine("Child");
  child.father = 5;
  child.notes = [createNote(1, 0, 0.6), createNote(2, 1, 0.7, 2)];
  child.eventLayers[0].alphaEvents = [createEvent(255, 0, 0, 2)];
  chart.judgeLineList.push(child);

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

/** Build a paged document over one chart text. */
function documentFromText(text) {
  const scan = scanChartJson(text);
  const header = chartHeaderFromScan(scan);
  const tempo = new TempoMap(header.BPMList);
  const index = buildChartIndex(scan, tempo);
  return new ChartDocument({ header, index, provider: providerFromScan(scan) });
}

/** Visible note indices for one runtime at one time. */
function visibleNoteIndices(runtime, state, seconds) {
  const entries = runtime.visibleNotes(seconds, state, 1600 + Math.hypot(state.x, state.y));
  return entries.map((entry) => entry.noteIndex).sort((left, right) => left - right);
}

/** Compare one paged scene against the full scene at `seconds`. */
async function compareAt(document, fullScene, fullChart, tempo, seconds) {
  await document.ensureTime(seconds, 3, { maxLines: 10000 });
  for (const index of document.loadedIndices()) {
    await document.ensureAncestors(index);
  }
  const pagedScene = new SceneRuntime();
  pagedScene.compile(document.chart, tempo);
  const fullStates = fullScene.sampleInto(seconds, []);
  const pagedStates = pagedScene.sampleInto(seconds, []);
  for (let index = 0; index < fullChart.judgeLineList.length; index++) {
    const fullState = fullStates[index];
    const fullRuntime = fullScene.lines[index];
    const fullNotes = fullRuntime ? visibleNoteIndices(fullRuntime, fullState, seconds) : [];
    const mustRender =
      fullState.alpha > 0 ||
      fullState.scaleX !== 0 ||
      fullState.scaleY !== 0 ||
      fullNotes.length > 0;
    if (!mustRender) {
      continue;
    }
    assert.ok(document.isLoaded(index), `line ${index} was not loaded at ${seconds}s`);
    const pagedState = pagedStates[index];
    const pagedRuntime = pagedScene.lines[index];
    assert.ok(pagedRuntime, `line ${index} has no paged runtime at ${seconds}s`);
    assert.deepEqual(
      {
        x: pagedState.x,
        y: pagedState.y,
        rotation: pagedState.rotation,
        alpha: pagedState.alpha,
        scaleX: pagedState.scaleX,
        scaleY: pagedState.scaleY,
        color: pagedState.color,
        text: pagedState.text,
        incline: pagedState.incline,
        floor: pagedState.floor,
      },
      {
        x: fullState.x,
        y: fullState.y,
        rotation: fullState.rotation,
        alpha: fullState.alpha,
        scaleX: fullState.scaleX,
        scaleY: fullState.scaleY,
        color: fullState.color,
        text: fullState.text,
        incline: fullState.incline,
        floor: fullState.floor,
      },
    );
    assert.deepEqual(
      visibleNoteIndices(pagedRuntime, pagedState, seconds),
      fullNotes,
      `line ${index} note visibility differs at ${seconds}s`,
    );
  }
}

test("paged scene matches the full scene across speed and line-event cases", async () => {
  const chart = renderChart();
  const text = serializeChart(chart);
  const document = documentFromText(text);
  const tempo = new TempoMap(chart.BPMList);
  const fullScene = new SceneRuntime();
  fullScene.compile(chart, tempo);
  for (const seconds of [0, 0.25, 0.5, 1, 1.5, 2, 3, 4, 5]) {
    await compareAt(document, fullScene, chart, tempo, seconds);
  }
});

/** Deterministic PRNG for the randomized rendering corpus. */
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** A randomized chart with bounded and unbounded line shapes. */
function randomChart(seed) {
  const random = prng(seed);
  const chart = createChart();
  chart.judgeLineList = [];
  const lineCount = 18;
  for (let index = 0; index < lineCount; index++) {
    const line = createLine(`Random ${index}`);
    line.notes = [];
    line.eventLayers[0].alphaEvents = [
      createEvent(random() > 0.5 ? 255 : 0, random() > 0.5 ? 255 : 0, 0, 1 + random() * 6),
    ];
    line.eventLayers[0].moveXEvents = [createEvent(0, (random() - 0.5) * 800, 0, 1 + random() * 8)];
    line.eventLayers[0].rotateEvents = [
      createEvent(0, (random() - 0.5) * 180, 0, 1 + random() * 8),
    ];
    if (random() > 0.5) {
      line.eventLayers[0].speedEvents = [
        createEvent((random() - 0.5) * 4, (random() - 0.5) * 4, 0, 1 + random() * 8),
      ];
    }
    line.father = index > 0 && random() > 0.7 ? Math.floor(random() * index) : -1;
    const noteCount = Math.floor(random() * 12);
    for (let noteIndex = 0; noteIndex < noteCount; noteIndex++) {
      const start = random() * 10;
      const type = 1 + Math.floor(random() * 4);
      const note = createNote(type, start, random() * 1.2 - 0.1, start + random() * 2);
      note.speed = [0, 0.01, 0.5, 1, 2, -1, -0.5][Math.floor(random() * 7)];
      note.visibleTime = [0, 1, 10, 999999][Math.floor(random() * 4)];
      note.isFake = random() > 0.9 ? 1 : 0;
      line.notes.push(note);
    }
    chart.judgeLineList.push(line);
  }
  return chart;
}

test("paged scene matches the full scene on randomized speed corpora", async () => {
  for (const seed of [1, 7, 42]) {
    const chart = randomChart(seed);
    const text = serializeChart(chart);
    const document = documentFromText(text);
    const tempo = new TempoMap(chart.BPMList);
    const fullScene = new SceneRuntime();
    fullScene.compile(chart, tempo);
    for (let seconds = 0; seconds <= 12; seconds += 0.5) {
      await compareAt(document, fullScene, chart, tempo, seconds);
    }
  }
});
