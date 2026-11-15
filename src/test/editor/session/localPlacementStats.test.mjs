/** Local placement totals follow note/event placement through undo and redo. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart } from "../../../core/global/chart/chart.ts";
import { placeEventAtTarget } from "../../../core/edit/events/eventCommands.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { placeTimelineNote } from "../../../core/edit/timeline/placement.ts";

test("undo and redo adjust local placement totals without going negative", () => {
  const session = new EditorSession(createChart());

  const pending = placeTimelineNote(session, 2, 4, 0, 0, null);
  placeTimelineNote(session, 2, 2, 0, 0, pending);
  assert.deepEqual(session.localPlacementStats, { notes: 1, events: 0 });
  assert.equal(session.travel("undo"), true);
  assert.deepEqual(session.localPlacementStats, { notes: 0, events: 0 });
  assert.equal(session.travel("undo"), false);
  assert.deepEqual(session.localPlacementStats, { notes: 0, events: 0 });
  assert.equal(session.travel("redo"), true);
  assert.deepEqual(session.localPlacementStats, { notes: 1, events: 0 });

  const result = placeEventAtTarget(session, {
    target: {
      lineIndex: 0,
      layer: 0,
      eventType: "moveXEvents",
      from: { beat: 4, positionX: 0 },
      to: { beat: 6, positionX: 0 },
    },
  });
  assert.equal(result.status, "committed");
  assert.deepEqual(session.localPlacementStats, { notes: 1, events: 1 });
  assert.equal(session.travel("undo"), true);
  assert.deepEqual(session.localPlacementStats, { notes: 1, events: 0 });
});
