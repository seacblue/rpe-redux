/**
 * Opening a chart must decode and JSON-parse once, share that value with the
 * diagnostics pass, validate once at the parser gate, and keep the fingerprint
 * computed at save time identical to the installed chart's fingerprint.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
  createNote,
  parseChart,
  serializeChart,
} from "../../../core/global/chart/chart.ts";
import {
  collectChartDiagnostics,
  parseChartDiagnostics,
} from "../../../core/global/chart/diagnostics.ts";
import { stripReduxExportVersion } from "../../../core/global/chart/exportProjection.ts";
import { parseChartEntries } from "../../../core/global/document/chartParsing.ts";
import { extensionRegistry } from "../../../core/extensions/runtime.ts";
import { beginLoading, loadingProgress } from "../../../core/global/document/loading.ts";
import {
  chartFingerprint,
  warmChartFingerprintAsync,
} from "../../../core/edit/document/chartRevision.ts";

const encoder = new TextEncoder();

/** Encode chart text as one archive entry. */
function entry(name, value) {
  return [name, encoder.encode(typeof value === "string" ? value : JSON.stringify(value))];
}

/** A small chart with a note, an event, an extended track, and a control point. */
function sampleChart() {
  const chart = createChart();
  chart.META.name = "Load Test";
  chart.judgeLineList[0].notes = [
    createNote(1, 0, 0),
    createNote(2, 1, 12, 2),
    { ...createNote(4, 3, -12), speed: 2, size: 0.5, alpha: 128 },
  ];
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(0, 100, 0, 1)];
  chart.judgeLineList[0].extended = {
    colorEvents: [createEvent([255, 255, 255], [255, 0, 0], 0, 1)],
  };
  chart.judgeLineList[0].alphaControl = [{ x: 0, alpha: 1, easing: 1 }];
  return chart;
}

test("parseChartEntries parses each entry exactly once", () => {
  const original = JSON.parse;
  let calls = 0;
  JSON.parse = function countedParse(...args) {
    calls += 1;
    return original.apply(this, args);
  };
  try {
    const result = parseChartEntries([entry("once.json", sampleChart())]);
    assert.equal(result.errors.length, 0);
    assert.equal(result.candidates.length, 1);
    assert.equal(calls, 1);
    assert.deepEqual(result.candidates[0].diagnostics, []);
  } finally {
    JSON.parse = original;
  }
});

test("diagnostics keep the same issues after the no-copy validation pass", () => {
  const invalid = {
    META: { RPEVersion: 170, name: "Broken", offset: 0 },
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    judgeLineList: [
      {
        bpmfactor: 0,
        notes: [
          null,
          { type: 9, positionX: "x", startTime: [0, 0, 1], endTime: [0, 0, 1] },
          { type: 1, positionX: 0, startTime: [0, 0, 0], endTime: [0, 0, 1] },
        ],
        eventLayers: { moveXEvents: [] },
        extended: {
          colorEvents: [
            { startTime: [0, 0, 1], endTime: [0, 0, 1], start: [255, 0], end: [0, 0, 0] },
            {
              startTime: [0, 0, 1],
              endTime: [0, 0, 1],
              start: [255, 0, 0],
              end: [0, 0, 0],
              bezier: 1,
              bezierPoints: [0, 0],
            },
          ],
          textEvents: "bad",
        },
        alphaControl: [{ x: 0 }, { x: "x", alpha: 1 }],
        skewControl: "bad",
      },
    ],
  };
  const paths = collectChartDiagnostics(invalid).map((issue) => issue.path);
  assert.deepEqual(paths, [
    "judgeLineList[0].bpmfactor",
    "judgeLineList[0].notes[0]",
    "judgeLineList[0].notes[1]",
    "judgeLineList[0].notes[2].startTime",
    "judgeLineList[0].eventLayers",
    "judgeLineList[0].extended.colorEvents[0]",
    "judgeLineList[0].extended.colorEvents[1].bezierPoints",
    "judgeLineList[0].extended.textEvents",
    "judgeLineList[0].alphaControl[0]",
    "judgeLineList[0].alphaControl[1]",
    "judgeLineList[0].skewControl",
  ]);

  const invalidEvents = {
    META: { RPEVersion: 170, name: "Broken", offset: 0 },
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    judgeLineList: [
      {
        notes: [],
        eventLayers: [
          {
            moveXEvents: [
              { startTime: [0, 0, 0], endTime: [0, 0, 1], start: 0, end: 1, easingLeft: "x" },
              { startTime: [0, 0, 1], endTime: [0, 0, 1], start: "x", end: 1 },
              {
                startTime: [0, 0, 1],
                endTime: [0, 0, 1],
                start: 0,
                end: 1,
                trajectory: { version: 2, segments: 3 },
              },
            ],
          },
        ],
      },
    ],
  };
  assert.deepEqual(
    collectChartDiagnostics(invalidEvents).map((issue) => issue.path),
    [
      "judgeLineList[0].eventLayers[0].moveXEvents[0].startTime",
      "judgeLineList[0].eventLayers[0].moveXEvents[0].easingLeft",
      "judgeLineList[0].eventLayers[0].moveXEvents[1]",
      "judgeLineList[0].eventLayers[0].moveXEvents[2].trajectory",
    ],
  );
});

test("invalid entries still open read-only with the same diagnostics", () => {
  const result = parseChartEntries([
    entry("broken.json", "{ not json"),
    entry("bad-fields.json", {
      META: { RPEVersion: 170 },
      BPMList: [],
      judgeLineList: "no",
    }),
  ]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.candidates.length, 2);
  const [broken, badFields] = result.candidates;
  assert.equal(broken.readOnly, true);
  assert.equal(broken.diagnostics[0].messageKey, "model.chart.invalidJson");
  assert.equal(broken.diagnostics[0].path, "$");
  // Sanitized read-only candidates stay openable, so the archive-level issue
  // list remains empty just as it did before the single-parse change.
  assert.deepEqual(result.issues, []);
  assert.equal(badFields.readOnly, true);
  assert.deepEqual(
    badFields.diagnostics.map((issue) => issue.path),
    ["BPMList", "judgeLineList"],
  );
  assert.deepEqual(
    badFields.diagnostics.map((issue) => issue.messageKey),
    ["model.tempo.emptyList", "model.validation.mustBeArray"],
  );
  assert.deepEqual(
    parseChartDiagnostics("{ not json").issues.map((issue) => issue.messageKey),
    ["model.chart.invalidJson"],
  );
});

test("a chart rejected by the structural gate still reports the same error", () => {
  const chart = {
    META: { RPEVersion: 170, name: "Hook damage" },
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    judgeLineList: [{ notes: [], eventLayers: [{ moveXEvents: [] }] }],
  };
  const text = JSON.stringify(chart);
  const dispose = extensionRegistry.onHook("chart:parsed", ({ chart: parsed }) => {
    delete parsed.META;
  });
  try {
    let expected = "";
    assert.throws(
      () => parseChart(text),
      (error) => {
        expected = error instanceof Error ? error.message : String(error);
        return /META|missing/i.test(expected);
      },
    );
    const result = parseChartEntries([entry("hook-damage.json", text)]);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0], `hook-damage.json: ${expected}`);
  } finally {
    dispose();
  }
});

test("fingerprint is identical for the installed, streamed, and saved chart", async () => {
  const source = sampleChart();
  const direct = chartFingerprint(source);

  // Worker streaming rebuilds the header and line list from separate messages.
  const parsed = parseChartEntries([entry("stream.json", source)]);
  assert.equal(parsed.errors.length, 0);
  const installed = parsed.candidates[0].chart;
  const { judgeLineList = [], ...header } = installed;
  const streamed = { ...header, judgeLineList: [...judgeLineList] };
  assert.equal(chartFingerprint(streamed), direct);

  // The session warms the same object after the first frame; save and conflict
  // checks read that cached digest.
  assert.equal(await warmChartFingerprintAsync(installed), direct);
  assert.equal(chartFingerprint(installed), direct);

  // Saving serializes the working chart; reopening it must keep the same digest.
  const saved = parseChart(serializeChart(installed));
  assert.equal(chartFingerprint(saved), direct);

  // Removing the export marker before installation must also keep the digest.
  const exported = { ...structuredClone(source), META: { ...source.META, ReduxVersion: "1.0" } };
  stripReduxExportVersion(exported);
  assert.equal(chartFingerprint(exported), direct);
});

test("failed loading keeps the explanation, solution, and code as separate fields", () => {
  const task = beginLoading("broken chart");
  const failure = Object.assign(new Error("The chart is too large."), {
    code: "chart_too_large",
    solution: "Reduce the chart size and try again.",
  });
  task.fail(failure);

  const state = loadingProgress.getSnapshot();
  assert.equal(state?.error, "The chart is too large.");
  assert.equal(state?.errorCode, "chart_too_large");
  assert.equal(state?.errorSolution, "Reduce the chart size and try again.");
  loadingProgress.dismiss();
});
