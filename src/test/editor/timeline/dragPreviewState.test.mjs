/** The transient drag preview drives the inspector without touching the chart. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent } from "../../../core/global/chart/chart.ts";
import { beatValue } from "../../../core/global/chart/timing/beat.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import {
  setTimelineDragPreview,
  timelineDragPreview,
} from "../../../core/edit/timeline/dragPreviewState.ts";
import {
  clearEventDragPreview,
  eventEdgeDragFor,
  syncEventDragPreview,
} from "../../../frontend/screens/editor/workspace/timeline/events/eventEdgeDrag.ts";

test("a drag preview reports only real head or tail changes", () => {
  setTimelineDragPreview(null);
  const note = { type: 2, startTime: [1, 0, 1], endTime: [2, 0, 1] };

  assert.equal(setTimelineDragPreview({ kind: "note", lineIndex: 0, index: 0, note }), true);
  assert.equal(timelineDragPreview()?.note, note);
  assert.equal(
    setTimelineDragPreview({
      kind: "note",
      lineIndex: 0,
      index: 0,
      note: { ...note, startTime: [1, 0, 1], endTime: [2, 0, 1] },
    }),
    false,
  );
  assert.equal(
    setTimelineDragPreview({
      kind: "note",
      lineIndex: 0,
      index: 0,
      note: { ...note, startTime: [3, 2, 1] },
    }),
    true,
  );
  assert.equal(setTimelineDragPreview(null), true);
  assert.equal(setTimelineDragPreview(null), false);
});

test("an event edge preview follows the edge without changing the chart", () => {
  const chart = createChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(0, 0, 2, 4)];
  const session = new EditorSession(chart);
  const timeline = {
    getSession: () => session,
    viewport: { tempo: { seconds: () => 0 }, origin: 0, factorForLine: () => 1 },
  };
  const drag = eventEdgeDragFor(
    timeline,
    { type: "moveXEvents", index: 0, lineIndex: 0 },
    { x: 0, y: 100 },
    "startTime",
    1,
  );
  assert.ok(drag);

  assert.equal(syncEventDragPreview(timeline, drag, [1, 0, 1]), true);
  const preview = timelineDragPreview();
  assert.equal(preview?.kind, "event");
  assert.equal(beatValue(preview.event.startTime), 3);
  assert.equal(beatValue(preview.event.endTime), 4);
  assert.equal(beatValue(chart.judgeLineList[0].eventLayers[0].moveXEvents[0].startTime), 2);
  assert.equal(syncEventDragPreview(timeline, drag, [1, 0, 1]), false);
  assert.equal(clearEventDragPreview(), true);
  assert.equal(timelineDragPreview(), null);
});
