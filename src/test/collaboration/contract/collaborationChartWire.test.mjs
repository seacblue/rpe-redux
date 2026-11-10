/** Checks the gzip chart wire encoding used by room create, welcome, and snapshot. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeChartWire,
  encodeChartWire,
  MAX_CHART_JSON_BYTES,
} from "../../../core/collaboration/chartWire.ts";

function chart() {
  return {
    META: { name: "压缩房间", artist: "RPE" },
    BPMList: [{ beat: [0, 0, 1], bpm: 180 }],
    judgeLineList: [
      {
        id: "line",
        notes: Array.from({ length: 2000 }, (_, index) => ({
          id: `note-${index}`,
          positionX: index % 7,
          type: 1,
        })),
        eventLayers: [],
      },
    ],
  };
}

test("a chart round-trips through base64 gzip", async () => {
  const value = chart();
  const encoded = await encodeChartWire(value);
  assert.equal(encoded.chartEncoding, "gzip");
  assert.notEqual(typeof encoded.chart, "object");
  assert.deepEqual(await decodeChartWire(encoded.chart, encoded.chartEncoding), value);
});

test("inline objects pass through the decoder unchanged", async () => {
  const value = chart();
  assert.equal(await decodeChartWire(value), value);
  assert.equal(await decodeChartWire(value, undefined), value);
});

test("repetitive chart JSON compresses far below its source size", async () => {
  const source = JSON.stringify(chart());
  const encoded = await encodeChartWire(chart());
  assert.ok(encoded.chart.length < source.length / 4);
  assert.ok(source.length < MAX_CHART_JSON_BYTES);
});

test("a malformed gzip payload is rejected instead of applied", async () => {
  await assert.rejects(() => decodeChartWire("not base64!", "gzip"));
  await assert.rejects(() => decodeChartWire(42, "gzip"));
});
