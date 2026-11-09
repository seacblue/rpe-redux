/** Two-click placement orders reversed anchors before it commits chart content. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart } from "../../../core/global/chart/chart.ts";
import { beatValue } from "../../../core/global/chart/timing/beat.ts";
import { placeEventAtTarget } from "../../../core/edit/events/eventCommands.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { placeTimelineNote } from "../../../core/edit/timeline/placement.ts";

test("a Hold finished before its first click commits the earlier click as the start", () => {
  const session = new EditorSession(createChart());
  let pending = placeTimelineNote(session, 2, 4, 0, 0, null);
  assert.ok(pending);
  pending = placeTimelineNote(session, 2, 2, 0, 0, pending);
  assert.equal(pending, null);

  assert.equal(session.notes.length, 1);
  assert.deepEqual(session.notes[0].startTime, [2, 0, 1]);
  assert.deepEqual(session.notes[0].endTime, [4, 0, 1]);
});

test("an event finished before its first click commits the earlier click as the start", () => {
  const session = new EditorSession(createChart());
  const result = placeEventAtTarget(session, {
    target: {
      lineIndex: 0,
      layer: 0,
      eventType: "moveXEvents",
      from: { beat: 4, positionX: 0 },
      to: { beat: 2, positionX: 0 },
    },
  });
  assert.equal(result.status, "committed");

  const events = session.chart.judgeLineList[0].eventLayers[0].moveXEvents ?? [];
  const placed = events.find(
    (event) => beatValue(event.startTime) === 2 && beatValue(event.endTime) === 4,
  );
  assert.ok(placed, "the placed event carries the ordered 2-4 beat span");
  assert.deepEqual(placed.startTime, [2, 0, 1]);
  assert.deepEqual(placed.endTime, [4, 0, 1]);
});
