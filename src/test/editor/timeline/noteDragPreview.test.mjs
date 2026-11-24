/** Verifies that a single-note drag produces a transient chart for the preview surface. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { previewChartForNoteDrag } from "../../../core/edit/timeline/dragPreview.ts";

function note(startTime = 1, endTime = startTime) {
  return {
    type: 1,
    startTime,
    endTime,
    positionX: 0,
  };
}

test("single-note drag preview changes the chart without committing the session", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes = [note()];
  const session = new EditorSession(chart);
  session.selection.add(0);
  const preview = previewChartForNoteDrag(session, (value) => ({
    ...value,
    startTime: 2,
    endTime: 2,
  }));

  assert.notEqual(preview, null);
  assert.equal(preview.judgeLineList[0].notes[0].startTime, 2);
  assert.equal(session.chart.judgeLineList[0].notes[0].startTime, 1);
});

test("an unchanged pointer sample does not create a preview chart", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes = [note()];
  const session = new EditorSession(chart);
  session.selection.add(0);
  assert.equal(
    previewChartForNoteDrag(session, (value) => value),
    null,
  );
});
