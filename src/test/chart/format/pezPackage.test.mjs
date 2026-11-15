/** PEZ exports carry the package identity and defaults native RPE expects. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart } from "../../../core/global/chart/chart.ts";
import {
  chartExportId,
  projectChartForExport,
  stripReduxExportVersion,
} from "../../../core/global/chart/exportProjection.ts";
import { buildInfoText } from "../../../core/global/document/info.ts";
import { createChartExport } from "../../../core/global/document/export.ts";
import { packageEntries, preparePezExportAssets } from "../../../core/global/document/package.ts";

const decoder = new TextDecoder();

test("chart export always writes a PEZ package", async () => {
  const chart = createChart();
  chart.META.name = "Export Test";
  const result = createChartExport(chart, new Map(), "Export Test", { name: "Export Test.json" });
  assert.equal(result.name, "Export Test.pez");
  assert.equal(result.blob.type, "application/zip");
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
});

test("export projection adds a numeric package id and native line defaults", () => {
  const chart = createChart();
  chart.META.name = "Package Test";
  const projected = projectChartForExport(chart, "Package Test.pez");
  const id = projected.META.id;

  assert.match(id, /^\d{16}$/);
  assert.equal(id, chartExportId(chart, "Package Test.pez"));
  assert.equal(projected.multiLineString, undefined);
  assert.equal(projected.multiScale, undefined);

  const line = projected.judgeLineList[0];
  assert.deepEqual(line.alphaControl, [
    { x: 0, alpha: 1, easing: 1 },
    { x: 9_999_999, alpha: 1, easing: 1 },
  ]);
  assert.deepEqual(line.posControl?.[1], { x: 9_999_999, pos: 1, easing: 1 });
  assert.deepEqual(line.sizeControl?.[0], { x: 0, size: 1, easing: 1 });
  assert.deepEqual(line.skewControl?.[0], { x: 0, skew: 0, easing: 1 });
  assert.deepEqual(line.yControl?.[1], { x: 9_999_999, y: 1, easing: 1 });
  assert.deepEqual(line.extended?.inclineEvents, []);

  // The working chart stays unchanged; defaults exist only in the export view.
  assert.equal(chart.META.id, undefined);
  assert.equal(chart.judgeLineList[0].alphaControl, undefined);
  assert.equal(chart.multiScale, undefined);
});

test("export projection fills native note and event defaults", () => {
  const chart = createChart();
  chart.META.name = "Minimal";
  const line = chart.judgeLineList[0];
  line.notes = [
    { type: 1, startTime: [0, 0, 1], endTime: [0, 0, 1], positionX: 12 },
    { type: 2, startTime: [1, 0, 1], endTime: [2, 0, 1], positionX: -40, alpha: 128 },
  ];
  line.eventLayers = [
    {
      moveXEvents: [{ startTime: [0, 0, 1], endTime: [1, 0, 1], start: 0, end: 100 }],
      speedEvents: [{ startTime: [0, 0, 1], endTime: [1, 0, 1], start: 10, end: 10 }],
    },
  ];
  line.extended = {
    colorEvents: [
      {
        start: [255, 255, 255],
        end: [255, 0, 0],
        startTime: [0, 0, 1],
        endTime: [1, 0, 1],
      },
    ],
  };
  const before = structuredClone(chart);

  const projected = projectChartForExport(chart, "Minimal.pez");
  const projectedLine = projected.judgeLineList[0];
  assert.deepEqual(projectedLine.notes[0], {
    type: 1,
    startTime: [0, 0, 1],
    endTime: [0, 0, 1],
    positionX: 12,
    above: 1,
    isFake: 0,
    speed: 1,
    size: 1,
    yOffset: 0,
    visibleTime: 999_999,
    alpha: 255,
  });
  assert.equal(projectedLine.notes[1].alpha, 128);
  assert.equal(projectedLine.notes[1].size, 1);

  const move = projectedLine.eventLayers[0].moveXEvents[0];
  assert.deepEqual(move, {
    startTime: [0, 0, 1],
    endTime: [1, 0, 1],
    start: 0,
    end: 100,
    bezier: 0,
    bezierPoints: [0, 0, 0, 0],
    easingLeft: 0,
    easingRight: 1,
    easingType: 1,
    linkgroup: 0,
  });
  const speed = projectedLine.eventLayers[0].speedEvents[0];
  assert.equal(speed.bezier, undefined);
  assert.equal(speed.bezierPoints, undefined);
  assert.equal(speed.easingType, 1);
  assert.equal(speed.easingRight, 1);
  assert.equal(speed.linkgroup, 0);
  assert.deepEqual(projectedLine.extended.colorEvents[0].bezierPoints, [0, 0, 0, 0]);

  assert.deepEqual(projected.META.ReduxExportDefaults.notes, [0]);
  assert.deepEqual(projected.META.ReduxExportDefaults.events, [0]);
  // The working chart stays untouched until the export marker is stripped.
  assert.equal(line.notes[0].alpha, undefined);
  assert.equal(line.eventLayers[0].moveXEvents[0].easingRight, undefined);

  stripReduxExportVersion(projected);
  assert.deepEqual(projected, before);
});

test("export projection preserves authored ids, controls, and editor fields", () => {
  const chart = createChart();
  chart.META.id = "0998907714863109";
  chart.multiScale = 0.5;
  chart.multiLineString = "0:3";
  chart.judgeLineList[0].alphaControl = [{ x: 0, alpha: 0.5, easing: 1 }];
  chart.judgeLineList[0].extended = { inclineEvents: [] };

  const projected = projectChartForExport(chart, "anything.pez");

  assert.equal(projected.META.id, "0998907714863109");
  assert.equal(projected.multiScale, 0.5);
  assert.equal(projected.multiLineString, "0:3");
  assert.deepEqual(projected.judgeLineList[0].alphaControl, [{ x: 0, alpha: 0.5, easing: 1 }]);
});

test("package layout uses the project id as the root chart entry", () => {
  const chart = createChart();
  chart.META.name = "Package Test";
  chart.META.song = "song.ogg";
  chart.META.background = "cover.png";
  const entries = packageEntries(
    chart,
    new Map([["cover.png", new Uint8Array([1])]]),
    "nested/Package Test.pez",
  );
  const id = chartExportId(chart, "nested/Package Test.pez");

  assert.deepEqual([...entries.keys()].sort(), ["cover.png", "info.txt", `${id}.json`].sort());
  const chartEntry = JSON.parse(decoder.decode(entries.get(`${id}.json`)));
  assert.equal(chartEntry.META.id, id);
  assert.equal(chartEntry.judgeLineList[0].sizeControl.length, 2);

  const info = decoder.decode(entries.get("info.txt"));
  assert.match(info, /^#\r\n/);
  assert.match(info, new RegExp(`^Path: ${id}$`, "m"));
  assert.match(info, new RegExp(`^Chart: ${id}\\.json$`, "m"));
});

test("native PEZ export replaces a stale extra sidecar with current effects", () => {
  const chart = createChart();
  chart.META.id = "1234567890123456";
  chart.effects = [
    {
      shader: "shaders/tokonagi.glsl",
      order: 99,
      vars: { amount: 0.5 },
    },
  ];
  const stale = new TextEncoder().encode(
    JSON.stringify({
      effects: [{ shader: "shaders/tokonagi.glsl", order: 0, vars: { amount: 1 } }],
    }),
  );
  const assets = new Map([
    ["extra.json", stale],
    ["shaders/tokonagi.glsl", new Uint8Array([1, 2, 3])],
  ]);

  const output = preparePezExportAssets(chart, assets, "chart.json");
  const extra = JSON.parse(decoder.decode(output.get("extra.json")));

  assert.deepEqual(extra.effects, chart.effects);
  assert.notEqual(output.get("extra.json"), stale);
  assert.deepEqual(output.get("shaders/tokonagi.glsl"), assets.get("shaders/tokonagi.glsl"));
});

test("Info.txt keeps caller fields while the package identity wins", () => {
  const chart = createChart();
  chart.META.id = "1234567890123456";
  const info = buildInfoText(chart, "1234567890123456.json", "#\nPath: old\nCustom: keep\n");

  assert.match(info, /^Path: 1234567890123456$/m);
  assert.match(info, /^Chart: 1234567890123456\.json$/m);
  assert.match(info, /^Custom: keep$/m);
});

test("opening a Redux package removes only the defaults it generated", () => {
  const chart = createChart();
  chart.META.name = "Canonical";
  delete chart.judgeLineGroup;
  delete chart.judgeLineList[0].extended;
  const before = structuredClone(chart);
  const exported = projectChartForExport(chart, "Canonical.pez");

  assert.ok(exported.META.ReduxExportDefaults);
  stripReduxExportVersion(exported);
  assert.deepEqual(exported, before);
});

test("opening a Redux package keeps authored ids and control tracks", () => {
  const chart = createChart();
  chart.META.id = "authored";
  chart.multiScale = 0.5;
  chart.judgeLineList[0].alphaControl = [{ x: 0, alpha: 0.5, easing: 1 }];
  const exported = projectChartForExport(chart, "chart.pez");

  stripReduxExportVersion(exported);
  assert.equal(exported.META.id, "authored");
  assert.equal(exported.multiScale, 0.5);
  assert.deepEqual(exported.judgeLineList[0].alphaControl, [{ x: 0, alpha: 0.5, easing: 1 }]);
  assert.equal(exported.judgeLineList[0].posControl, undefined);
});
