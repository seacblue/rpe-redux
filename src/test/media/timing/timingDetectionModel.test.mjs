/** The timing dialog's pure measurement, offset-nudge, and apply rules. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart } from "../../../core/global/chart/chart.ts";
import {
  applyDetectedTiming,
  applyTimingLabelKey,
  parseTimingDraft,
  scaleMeasuredBpm,
  shiftOffsetByBeats,
} from "../../../frontend/screens/editor/workspace/timingDetection/timingDetectionModel.ts";

test("invalid or empty fields do not produce a draft", () => {
  assert.equal(parseTimingDraft("", "0"), null);
  assert.equal(parseTimingDraft("120", ""), null);
  assert.equal(parseTimingDraft("0", "0"), null);
  assert.equal(parseTimingDraft("-120", "0"), null);
  assert.equal(parseTimingDraft("120", "not a number"), null);
  assert.deepEqual(parseTimingDraft("174.02", "-12.5"), { bpm: 174.02, offsetMs: -12.5 });
});

test("tempo scaling keeps the detector's precision", () => {
  assert.equal(scaleMeasuredBpm(174.02, 0.5), 87.01);
  assert.equal(scaleMeasuredBpm(174.02, 2), 348.04);
  assert.equal(scaleMeasuredBpm(123.457, 0.5), 61.729);
  assert.equal(scaleMeasuredBpm(0, 2), null);
  assert.equal(scaleMeasuredBpm(Number.NaN, 2), null);
  assert.equal(scaleMeasuredBpm(120, 0), null);
});

test("one beat of offset follows the current BPM", () => {
  assert.equal(shiftOffsetByBeats(1000, 120, 1), 1500);
  assert.equal(shiftOffsetByBeats(1500, 120, -1), 1000);
  assert.equal(shiftOffsetByBeats(0, 174.02, 1), 344.788);
  assert.equal(shiftOffsetByBeats(344.788, 174.02, -1), 0);
});

test("a beat nudge rounds to the measurement precision and snaps near integers", () => {
  assert.equal(shiftOffsetByBeats(349.9995, 128, 1), 818.75);
  assert.equal(shiftOffsetByBeats(620.0005, 120, 0), 620);
  assert.equal(shiftOffsetByBeats(0, 0, 1), null);
  assert.equal(shiftOffsetByBeats(Number.NaN, 120, 1), null);
});

test("applying replaces a multi-BPM chart with one fixed entry", () => {
  const chart = createChart();
  const multi = {
    ...chart,
    BPMList: [
      { bpm: 120, startTime: [0, 0, 1] },
      { bpm: 150, startTime: [16, 0, 1] },
    ],
  };
  const applied = applyDetectedTiming(multi, "174.02", "620.4");
  assert.ok(applied);
  assert.equal(applied.chart.BPMList.length, 1);
  assert.equal(applied.chart.BPMList[0].bpm, 174.02);
  assert.deepEqual(applied.chart.BPMList[0].startTime, [0, 0, 1]);
  assert.equal(applied.chart.META.offset, 620.4);
  assert.equal(applied.seekMs, 620.4);
  assert.equal(applyTimingLabelKey(multi), "editorPanels.timingDetection.replaceAndApply");
  assert.equal(applyTimingLabelKey(chart), "editorPanels.timingDetection.apply");
});

test("an invalid draft leaves the chart unapplied", () => {
  assert.equal(applyDetectedTiming(createChart(), "0", "0"), null);
  assert.equal(applyDetectedTiming(createChart(), "120", ""), null);
});
