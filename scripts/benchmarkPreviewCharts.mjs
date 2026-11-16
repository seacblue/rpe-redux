/** Benchmarks chart loading, scene sampling, and visible-note collection on supplied PEZ files. */
import { readFileSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { unzipSync } from "fflate";
import { parseChart } from "../src/core/global/chart/chart.ts";
import { beatValue } from "../src/core/global/chart/timing/beat.ts";
import { TempoMap } from "../src/core/global/chart/timing/tempo.ts";
import { SceneRuntime } from "../src/core/global/chart/runtime/scene.ts";
import { decodeChartText } from "../src/core/utils/text.ts";

const files = process.argv.slice(2);
function endBeat(chart) {
  let result = 0;
  const visit = (value) => {
    if (Array.isArray(value)) {
      try {
        result = Math.max(result, beatValue(value));
      } catch {}
    }
  };
  for (const bpm of chart.BPMList ?? []) {
    visit(bpm.startTime);
  }
  for (const line of chart.judgeLineList ?? []) {
    for (const layer of [...(line.eventLayers ?? []), line.extended]) {
      for (const values of Object.values(layer ?? {})) {
        for (const event of values ?? []) {
          visit(event?.startTime);
          visit(event?.endTime);
        }
      }
    }
    for (const note of line.notes ?? []) {
      visit(note.startTime);
      visit(note.endTime);
    }
  }
  return result;
}
function loadChart(path) {
  const bytes = readFileSync(path);
  if (bytes.toString("ascii", 0, 2) !== "PK") {
    return parseChart(decodeChartText(bytes));
  }
  const entries = Object.entries(unzipSync(new Uint8Array(bytes))).filter(([name]) =>
    /\.json$/i.test(name),
  );
  if (entries.length !== 1) {
    throw new Error(`Expected one JSON chart in ${path}`);
  }
  return parseChart(decodeChartText(entries[0][1]));
}
function stats(chart) {
  let notes = 0;
  let events = 0;
  let parents = 0;
  for (const line of chart.judgeLineList ?? []) {
    notes += line.notes?.length ?? 0;
    if (Number(line.father) >= 0) {
      parents++;
    }
    for (const layer of [...(line.eventLayers ?? []), line.extended]) {
      for (const values of Object.values(layer ?? {})) {
        events += values?.length ?? 0;
      }
    }
  }
  return {
    lines: chart.judgeLineList?.length ?? 0,
    notes,
    events,
    parents,
    bpm: chart.BPMList?.length ?? 0,
  };
}
function run(scene, times, visible) {
  const states = [];
  const noteBuckets = scene.lines.map(() => []);
  const holdBuckets = scene.lines.map(() => []);
  let sink = 0;
  const samples = [];
  for (let warmup = 0; warmup < 30; warmup++) {
    scene.sampleInto(times[warmup % times.length], states);
  }
  for (const seconds of times) {
    const start = performance.now();
    scene.sampleInto(seconds, states);
    if (visible) {
      for (const index of scene.order) {
        const line = scene.lines[index];
        const state = states[index];
        if (!line || !state) {
          continue;
        }
        line.visibleNotes(
          seconds,
          state,
          1600 + Math.hypot(state.x, state.y),
          noteBuckets[index],
          holdBuckets[index],
        );
        sink += noteBuckets[index].length + holdBuckets[index].length;
      }
    }
    sink += states.length;
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    p50: samples[Math.floor(samples.length * 0.5)],
    p95: samples[Math.floor(samples.length * 0.95)],
    max: samples.at(-1),
    sink,
  };
}
for (const path of files) {
  const loadStart = performance.now();
  const chart = loadChart(path);
  const loadMs = performance.now() - loadStart;
  const tempo = new TempoMap(chart.BPMList ?? []);
  const scene = new SceneRuntime();
  const compileStart = performance.now();
  scene.compile(chart, tempo);
  const compileMs = performance.now() - compileStart;
  const duration = tempo.seconds(endBeat(chart), 1);
  const times = Array.from(
    { length: 160 },
    (_, index) => ((index + 0.5) / 160) * Math.max(0.001, duration),
  );
  const sample = run(scene, times, false);
  const preview = run(scene, times, true);
  const shape = stats(chart);
  console.log(
    JSON.stringify({
      file: path,
      size: statSync(path).size,
      shape,
      duration,
      loadMs,
      compileMs,
      sample,
      preview,
    }),
  );
}
