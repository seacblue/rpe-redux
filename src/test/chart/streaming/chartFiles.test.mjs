/**
 * Browser file-open path: a single JSON file goes through the streaming worker
 * adapter and reaches the document loader with a paged document.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createLine,
  createNote,
  serializeChart,
} from "../../../core/global/chart/chart.ts";
import { chartFingerprint } from "../../../core/edit/document/chartRevision.ts";
import { openChartFiles } from "../../../frontend/screens/editor/workspace/document/open/chartFiles.ts";

/** A small chart with one note. */
function sampleChart() {
  const chart = createChart();
  chart.judgeLineList = [createLine("Line")];
  chart.judgeLineList[0].notes = [createNote(1, 0, 0.5)];
  return chart;
}

test("single JSON file reaches loadCandidate with a streaming document", async () => {
  const chart = sampleChart();
  const text = serializeChart(chart);
  const file = new File([text], "chart.json", { type: "application/json" });
  const expected = chartFingerprint(chart);
  let settle;
  const done = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  await openChartFiles([file], {
    guardReplace: (action) => {
      action();
    },
    loadCandidate: async (candidate) => {
      try {
        assert.ok(candidate.chartDocument);
        const materialized = await candidate.chartDocument.materializeAll();
        assert.equal(chartFingerprint(materialized), expected);
        settle.resolve();
      } catch (error) {
        settle.reject(error);
      }
    },
    chooseCandidates: () => {
      settle.reject(new Error("unexpected candidate picker"));
    },
    reportError: (error) => settle.reject(error),
  });
  await done;
});
