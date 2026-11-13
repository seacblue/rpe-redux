/**
 * Chart CRUD benchmark: measures the per-edit transaction path that pointer drags,
 * keyboard edits, and event inspectors hit on every frame.
 *
 * Each sample applies one request through the public transaction API
 * (`applyChartTransaction`), which plans the edit, validates it, recomputes the
 * canonical fingerprint, and commits history exactly like the editor does, and
 * reports median / p95 / max per operation for a cold session (fresh parse, no
 * importer seeds) and a seeded session (the fingerprint seeds the chart importer
 * installs, mirroring `installChartRevisionSeed`).
 *
 *   node --expose-gc scripts/benchmarkChartCrud.mjs
 *   node --expose-gc scripts/benchmarkChartCrud.mjs --iters 40 --chart synthetic-76k
 *   node --expose-gc scripts/benchmarkChartCrud.mjs --chart-file path/to/chart.json
 *   node --expose-gc scripts/benchmarkChartCrud.mjs --json > crud.json
 *
 * Flags:
 *   --iters N            measured edits per operation (default 20; 10 warmup edits run first)
 *   --chart NAME         one case name, or "all" (default: all available cases)
 *   --chart-file PATH    measure one chart JSON; repeat the flag for several files. The
 *                        case is named `file-<file name without .json>`. Charts are
 *                        loaded from whatever path is passed, so the script never
 *                        commits machine-specific chart locations.
 *   --json               machine-readable output on stdout; progress notes go to stderr
 *
 * Budget: one edit path must finish inside 3 ms. A 144 Hz frame is 6.94 ms, and an
 * edit shares that frame with rendering, so 3 ms is the per-edit ceiling. The run is
 * report-only: it never exits non-zero because a machine is slow or the budget is
 * missed, so it is useful as a profiler and as an acceptance measurement.
 *
 * Portability: the synthetic charts are always available, and real charts arrive only
 * through `--chart-file`, so the script never carries machine-specific chart locations.
 * This script is outside the unit suite because
 * it measures wall-clock cost; the committed budget test
 * (`src/test/editor/transactions/crudBudget.test.mjs`) guards the work counters.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { performance } from "node:perf_hooks";
import { createChart, createLine, parseChart } from "../src/core/global/chart/chart.ts";
import { EditorSession } from "../src/core/edit/session/session.ts";
import { applyChartTransaction } from "../src/core/edit/transaction/preview.ts";
import {
  chartFingerprint,
  installChartRevisionSeed,
} from "../src/core/edit/document/chartRevision.ts";
import { lineContentFingerprintParts } from "../src/core/global/chart/chartContentHash.ts";

/** Per-edit budget in milliseconds (144 Hz frame is 6.94 ms; one edit gets 3 ms). */
const EDIT_BUDGET_MS = 3;

/**
 * Unmeasured edits per operation before sampling.
 *
 * The edit path is JIT-compiled and lazily built on first touch, and a chart edit
 * has a long tail from major GC; ten warmup edits keep both out of the samples so
 * the reported numbers describe steady-state editing, which is what the budget governs.
 */
const WARMUP_EDITS = 10;

/** Operations measured per chart and scenario, in execution order. */
const OPERATIONS = ["note-update", "note-delete", "note-insert", "event-update"];

/**
 * Parses argv into options, rejecting unknown flags instead of silently ignoring them.
 *
 * @param {string[]} argv arguments after the script name
 * @returns {{ iters: number, chart: string, json: boolean, chartFiles: string[] }}
 */
function parseOptions(argv) {
  const options = { iters: 20, chart: "all", json: false, chartFiles: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--json") {
      options.json = true;
    } else if (flag === "--iters") {
      options.iters = Number(value);
      index += 1;
    } else if (flag === "--chart") {
      options.chart = value;
      index += 1;
    } else if (flag === "--chart-file") {
      if (!value) {
        throw new Error("--chart-file requires a JSON path");
      }
      options.chartFiles.push(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!Number.isInteger(options.iters) || options.iters < 1) {
    throw new Error(`--iters must be a positive integer, received ${options.iters}`);
  }
  return options;
}

/**
 * Summarizes one sample set in milliseconds with three decimals.
 *
 * The budget is applied to median and p95 per the report contract: `overBudget`
 * is true when either crosses {@link EDIT_BUDGET_MS}.
 *
 * @param {number[]} samples wall-clock durations in milliseconds
 * @returns {{ median: number, p95: number, max: number, overBudget: boolean }}
 */
function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (quantile) =>
    sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))];
  const round = (value) => Math.round(value * 1000) / 1000;
  const median = at(0.5);
  const p95 = at(0.95);
  return {
    median: round(median),
    p95: round(p95),
    max: round(sorted[sorted.length - 1]),
    overBudget: median > EDIT_BUDGET_MS || p95 > EDIT_BUDGET_MS,
  };
}

/**
 * Builds a deterministic synthetic chart.
 *
 * Note times are consecutive eighth beats so the transaction's ordering and
 * dedupe paths see realistic neighbors, and every line carries alpha events so
 * the event operation always has a target.
 *
 * @param {number} lines judge line count
 * @param {number} notesPerLine notes per judge line
 * @param {number} eventsPerLine alpha events per judge line
 * @returns {import("../src/core/global/chart/chart.ts").Chart}
 */
function buildSyntheticChart(lines, notesPerLine, eventsPerLine) {
  const chart = createChart();
  chart.META = { ...chart.META, name: `synthetic ${lines}x${notesPerLine}` };
  chart.BPMList = [{ bpm: 180, startTime: [0, 0, 1] }];
  const judgeLineList = [];
  for (let lineIndex = 0; lineIndex < lines; lineIndex += 1) {
    const line = createLine(`Line ${lineIndex}`);
    const notes = [];
    for (let noteIndex = 0; noteIndex < notesPerLine; noteIndex += 1) {
      const beat = Math.floor(noteIndex / 8);
      const base = [beat, 0, 8];
      notes.push({
        type: noteIndex % 7 === 0 ? 2 : 1,
        positionX: ((noteIndex * 37) % 1350) - 675,
        startTime: base,
        endTime: [beat + (noteIndex % 7 === 0 ? 1 : 0), 0, 8],
        alpha: 255,
        above: 1,
        size: 1,
      });
    }
    line.notes = notes;
    line.eventLayers[0].alphaEvents = [];
    for (let eventIndex = 0; eventIndex < eventsPerLine; eventIndex += 1) {
      line.eventLayers[0].alphaEvents.push({
        startTime: [eventIndex, 0, 4],
        endTime: [eventIndex + 1, 0, 4],
        start: 255,
        end: 255,
      });
    }
    judgeLineList.push(line);
  }
  chart.judgeLineList = judgeLineList;
  return chart;
}

/**
 * Counts lines, notes, and events so each report row states its workload.
 *
 * @param {import("../src/core/global/chart/chart.ts").Chart} chart parsed or synthetic chart
 * @returns {{ lines: number, notes: number, events: number }}
 */
function chartSize(chart) {
  let notes = 0;
  let events = 0;
  for (const line of chart.judgeLineList ?? []) {
    notes += line.notes?.length ?? 0;
    for (const layer of [...(line.eventLayers ?? []), line.extended]) {
      if (!layer) {
        continue;
      }
      for (const value of Object.values(layer)) {
        if (Array.isArray(value)) {
          events += value.length;
        }
      }
    }
  }
  return { lines: chart.judgeLineList?.length ?? 0, notes, events };
}

/**
 * Installs the fingerprint seeds a streaming importer would install, so the
 * seeded scenario measures the copy-on-write edit path rather than a cold rehash.
 *
 * @param {import("../src/core/global/chart/chart.ts").Chart} chart materialized chart
 */
function installImporterSeeds(chart) {
  const lines = chart.judgeLineList ?? [];
  installChartRevisionSeed(chart, {
    lines: lines.map((line) => lineContentFingerprintParts(line, { includeValueDigests: true })),
  });
}

/**
 * Index of the line with the most notes; note operations target that worst case.
 *
 * @param {import("../src/core/global/chart/chart.ts").Chart} chart current chart
 * @returns {number} line index, or -1 when the chart has no notes
 */
function noteHeaviestLine(chart) {
  let best = -1;
  let bestCount = 0;
  const lines = chart.judgeLineList ?? [];
  for (let index = 0; index < lines.length; index += 1) {
    const count = lines[index].notes?.length ?? 0;
    if (count > bestCount) {
      best = index;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Finds the line and event track an event update should target.
 *
 * The importer-shaped choice mirrors how a user hits the worst case: the judge line
 * carrying the most events (across its event layers and the extended track), then the
 * first non-empty base-layer track on it. When that line carries no base-layer event,
 * the scan falls back to the first line that does, so a chart with base-layer events
 * is never reported as skipped.
 *
 * @param {import("../src/core/global/chart/chart.ts").Chart} chart current chart
 * @returns {{ events: object[] } | null} target track, or null when the chart has no
 *   base-layer events
 */
function eventTarget(chart) {
  const lines = chart.judgeLineList ?? [];
  const trackOf = (line) =>
    Object.entries(line?.eventLayers?.[0] ?? {}).find(
      ([, value]) => Array.isArray(value) && value.length > 0,
    );
  let best = -1;
  let bestCount = 0;
  let fallback = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const track = trackOf(line);
    if (track && !fallback) {
      fallback = { lineIndex: index, events: track[1] };
    }
    let count = 0;
    for (const layer of [...(line.eventLayers ?? []), line.extended]) {
      if (!layer) {
        continue;
      }
      for (const value of Object.values(layer)) {
        if (Array.isArray(value)) {
          count += value.length;
        }
      }
    }
    if (count > bestCount) {
      best = index;
      bestCount = count;
    }
  }
  if (best < 0) {
    return fallback;
  }
  const track = trackOf(lines[best]);
  return track ? { lineIndex: best, events: track[1] } : fallback;
}

/**
 * Builds the request for one operation against the session's current chart.
 *
 * Patch values vary per call so the transaction never short-circuits into the
 * `unchanged` status, and every builder re-reads the chart so repeated edits stay
 * valid while the session accumulates history.
 *
 * @param {EditorSession} session live session whose chart is measured
 * @param {string} operation one of {@link OPERATIONS}
 * @param {{ value: number }} counter shared per-operation counter for value variation
 * @returns {object | null} a `ChartTransactionRequest`, or null when the chart has no target
 */
function requestBuilder(session, operation, counter) {
  const chart = session.chart;
  if (operation === "note-update") {
    const lineIndex = noteHeaviestLine(chart);
    if (lineIndex < 0) {
      return null;
    }
    const notes = chart.judgeLineList[lineIndex].notes;
    const note = notes[(counter.value * 37) % notes.length];
    counter.value += 1;
    return {
      notes: {
        update: [{ id: note.id, patch: { positionX: ((counter.value * 13) % 1300) - 650 + 0.5 } }],
      },
    };
  }
  if (operation === "note-delete") {
    const lineIndex = noteHeaviestLine(chart);
    if (lineIndex < 0) {
      return null;
    }
    const notes = chart.judgeLineList[lineIndex].notes;
    counter.value += 1;
    return { notes: { delete: [notes[Math.floor(notes.length / 2)].id] } };
  }
  if (operation === "note-insert") {
    const lineIndex = noteHeaviestLine(chart);
    if (lineIndex < 0) {
      return null;
    }
    const beat = Math.floor((counter.value * 7) % 4096);
    counter.value += 1;
    return {
      notes: {
        insert: [
          {
            lineIndex,
            note: {
              type: 1,
              positionX: (counter.value % 1300) - 650,
              startTime: [beat, 0, 8],
              endTime: [beat, 0, 8],
              alpha: 255,
              above: 1,
              size: 1,
            },
          },
        ],
      },
    };
  }
  if (operation === "event-update") {
    const target = eventTarget(chart);
    if (!target) {
      return null;
    }
    const event = target.events[(counter.value * 17) % target.events.length];
    counter.value += 1;
    return {
      events: { update: [{ id: event.id, patch: { start: event.start === 200 ? 201 : 200 } }] },
    };
  }
  throw new Error(`Unknown operation: ${operation}`);
}

/**
 * Measures one operation on one session.
 *
 * {@link WARMUP_EDITS} unmeasured edits run first so first-touch JIT and lazily
 * built indices stay out of the samples; the session state they leave behind is the
 * state a user's thousandth edit sees, which is what the budget governs.
 *
 * @param {EditorSession} session live session whose chart is measured
 * @param {string} operation one of {@link OPERATIONS}
 * @param {number} iters measured sample count
 * @returns {{ median: number, p95: number, max: number, overBudget: boolean } | null}
 */
function measureOperation(session, operation, iters) {
  const counter = { value: 0 };
  const build = () => requestBuilder(session, operation, counter);
  const commit = (request) => {
    const result = applyChartTransaction(session, request);
    if (result.status !== "committed" && result.status !== "unchanged") {
      throw new Error(`${operation} failed: ${JSON.stringify(result.issues ?? result.status)}`);
    }
  };
  const first = build();
  if (first === null) {
    return null;
  }
  for (let index = 0; index < WARMUP_EDITS; index += 1) {
    commit(index === 0 ? first : build());
  }
  globalThis.gc?.();
  const samples = [];
  for (let index = 0; index < iters; index += 1) {
    const request = build();
    if (request === null) {
      break;
    }
    const start = performance.now();
    commit(request);
    samples.push(performance.now() - start);
  }
  return samples.length === 0 ? null : summarize(samples);
}

/**
 * Runs one chart case for both scenarios.
 *
 * A fresh chart is built per scenario because delete edits shrink the measured
 * chart; sharing a session across scenarios would compare different workloads.
 *
 * @param {{ name: string, build: () => object }} chartCase case under test
 * @param {number} iters measured sample count per operation
 * @returns {{ size: { lines: number, notes: number, events: number }, scenarios: { seed: boolean, operations: object[] }[] }}
 */
function runCase(chartCase, iters) {
  const scenarios = [];
  let size = { lines: 0, notes: 0, events: 0 };
  for (const seeded of [false, true]) {
    const chart = chartCase.build();
    size = chartSize(chart);
    if (seeded) {
      installImporterSeeds(chart);
    }
    const session = new EditorSession(chart);
    // Warm the whole-chart fingerprint the way document installation does before
    // the first edit, so the first sample is not a cold hash.
    chartFingerprint(session.chart);
    const operations = [];
    for (const operation of OPERATIONS) {
      const stats = measureOperation(session, operation, iters);
      operations.push({ operation, stats });
    }
    scenarios.push({ seed: seeded, operations });
    // The session keeps up to 150 chart versions alive; collect them before the next
    // scenario builds another large chart so GC pauses stay out of later samples.
    globalThis.gc?.();
  }
  return { size, scenarios };
}

/**
 * Formats one measurement row.
 *
 * @param {{ operation: string, stats: object }} row measured operation
 * @returns {string}
 */
function formatRow(row) {
  const { stats } = row;
  if (!stats) {
    return `    ${row.operation.padEnd(12)} skipped (no target in chart)`;
  }
  const cell = (value) => String(value).padStart(7);
  return (
    `    ${row.operation.padEnd(12)} med ${cell(stats.median)}  p95 ${cell(stats.p95)}  ` +
    `max ${cell(stats.max)}  ${stats.overBudget ? "OVER 3 ms" : "within budget"}`
  );
}

/**
 * Prints the human-readable report.
 *
 * @param {{ iters: number, charts: { name: string, size: object, scenarios: object[] }[] }} report run result
 */
function printHuman(report) {
  console.log(
    `Chart CRUD benchmark — per-edit budget ${EDIT_BUDGET_MS} ms (144 Hz frame is 6.94 ms)`,
  );
  console.log(`iters ${report.iters}, cold = fresh parse, seeded = importer fingerprint seeds\n`);
  for (const chart of report.charts) {
    console.log(
      `### ${chart.name}  lines ${chart.size.lines}  notes ${chart.size.notes}  events ${chart.size.events}`,
    );
    for (const scenario of chart.scenarios) {
      console.log(`  ${scenario.seed ? "seeded" : "cold  "}`);
      for (const row of scenario.operations) {
        console.log(formatRow(row));
      }
    }
    console.log("");
  }
  const over = [];
  for (const chart of report.charts) {
    for (const scenario of chart.scenarios) {
      for (const row of scenario.operations) {
        if (row.stats?.overBudget) {
          over.push(`${chart.name} ${scenario.seed ? "seeded" : "cold"} ${row.operation}`);
        }
      }
    }
  }
  console.log(
    over.length === 0
      ? `All measurements within the ${EDIT_BUDGET_MS} ms budget.`
      : `Over budget (${over.length}): ${over.join(", ")}`,
  );
}

/**
 * Builds the available cases.
 *
 * Synthetic charts always exist, and every `--chart-file` path becomes a case named
 * `file-<file name without extension>` (suffixed when two files share a name).
 *
 * @param {string[]} chartFiles chart JSON paths passed on the command line
 * @returns {{ name: string, build: () => object, source: string, synthetic: boolean }[]}
 */
function availableCases(chartFiles) {
  const cases = [
    {
      name: "synthetic-15k",
      synthetic: true,
      source: "synthetic 1 line x 15000 notes",
      build: () => buildSyntheticChart(1, 15_000, 400),
    },
    {
      name: "synthetic-76k",
      synthetic: true,
      source: "synthetic 100 lines x 760 notes",
      build: () => buildSyntheticChart(100, 760, 300),
    },
  ];
  for (const path of chartFiles) {
    if (!existsSync(path)) {
      throw new Error(`--chart-file not found: ${path}`);
    }
    const stem = `file-${basename(path).replace(/\.[^.]+$/, "")}`;
    let name = stem;
    for (let suffix = 2; cases.some((chartCase) => chartCase.name === name); suffix += 1) {
      name = `${stem}-${suffix}`;
    }
    cases.push({
      name,
      synthetic: false,
      source: path,
      build: () => parseChart(readFileSync(path, "utf8")),
    });
  }
  return cases;
}

/** Runs the requested cases and emits the report. */
function main() {
  const options = parseOptions(process.argv.slice(2));
  const cases = availableCases(options.chartFiles);
  const selected =
    options.chart === "all" ? cases : cases.filter((chartCase) => chartCase.name === options.chart);
  if (selected.length === 0) {
    throw new Error(
      `Unknown --chart ${options.chart}; available: ${cases.map((chartCase) => chartCase.name).join(", ")}`,
    );
  }

  const report = { generatedAt: new Date().toISOString(), iters: options.iters, charts: [] };
  for (const chartCase of selected) {
    if (!options.json) {
      console.error(`Running ${chartCase.name} (${options.iters} iters)...`);
    }
    const { size, scenarios } = runCase(chartCase, options.iters);
    report.charts.push({ name: chartCase.name, source: chartCase.source, size, scenarios });
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printHuman(report);
}

main();
