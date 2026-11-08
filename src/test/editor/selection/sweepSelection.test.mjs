/** Freehand timeline selection adds and removes only objects touched by a path. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createNote } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { refreshNoteIndex } from "../../../core/edit/timeline/noteIndex.ts";
import { TimelineGestures } from "../../../frontend/screens/editor/workspace/timeline/interaction/timelineGestures.ts";
import {
  selectEventsAlongSegment,
  selectNotesAlongSegment,
  shouldSuppressTimelineContextMenu,
} from "../../../core/edit/timeline/selection.ts";

test("a note sweep selects and then removes the note it crosses", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes = [createNote(1, 2, 0)];
  const session = new EditorSession(chart);
  const indexes = new Map();
  refreshNoteIndex(indexes, 0, session.notes);
  const bounds = () => ({ left: -5, right: 5, top: 45, bottom: 55 });

  selectNotesAlongSegment(
    session,
    { startX: 0, startY: 0, endX: 0, endY: 100 },
    { indexForLine: (lineIndex) => indexes.get(lineIndex), bounds },
  );
  assert.deepEqual([...session.selection], [0]);

  selectNotesAlongSegment(
    session,
    { startX: 0, startY: 100, endX: 0, endY: 0, remove: true },
    { indexForLine: (lineIndex) => indexes.get(lineIndex), bounds },
  );
  assert.deepEqual([...session.selection], []);
});

test("an event sweep uses drawn event bars and does not select an unrelated bar", () => {
  const chart = createChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(0, 1, 2, 3)];
  const session = new EditorSession(chart);
  selectEventsAlongSegment(
    session,
    { startX: 20, startY: 0, endX: 20, endY: 100 },
    {
      scroll: 0,
      rectangles: [
        { x: 10, y: 40, width: 20, height: 20, type: "moveXEvents", index: 0 },
        { x: 50, y: 40, width: 20, height: 20, type: "moveXEvents", index: 1 },
      ],
    },
  );
  assert.deepEqual([...session.eventSelection], ["moveXEvents:0"]);
});

test("right-click sweep suppresses the menu only after movement", () => {
  assert.equal(shouldSuppressTimelineContextMenu({ button: 2, moved: false }), false);
  assert.equal(shouldSuppressTimelineContextMenu({ button: 2, moved: true }), true);
  assert.equal(shouldSuppressTimelineContextMenu({ button: 0, moved: true }), false);
});

test("right-drag menu suppression is consumed once", () => {
  const gestures = new TimelineGestures({}, () => new EditorSession(createChart()));
  gestures.suppressNextContextMenu();
  assert.equal(gestures.consumeContextMenuSuppression(), true);
  assert.equal(gestures.consumeContextMenuSuppression(), false);
  gestures.suppressNextContextMenu();
  gestures.clearContextMenuSuppression();
  assert.equal(gestures.consumeContextMenuSuppression(), false);
});
