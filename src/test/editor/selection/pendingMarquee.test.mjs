/** Covers cancellation of a two-click timeline marquee outside the stage. */
import assert from "node:assert/strict";
import test from "node:test";
import { finishRectangle } from "../../../frontend/screens/editor/workspace/timeline/selection/rectangleSelection.ts";
import { TimelineGestures } from "../../../frontend/screens/editor/workspace/timeline/interaction/timelineGestures.ts";

/** Build the smallest timeline receiver needed by the pending-marquee seam. */
function receiverWithPendingNoteMarquee() {
  const drag = {
    kind: "rectangle",
    area: "notes",
    pointerId: 1,
    start: { x: 20, y: 20 },
    current: { x: 20, y: 20 },
    append: true,
    finished: false,
  };
  const gestures = new TimelineGestures({ drag: null }, () => ({}));
  gestures.drag = drag;
  const receiver = {
    gestures,
    rectangleSelection() {
      return { drag: this.gestures.drag, canvas: {}, area: "notes" };
    },
    sweepSelection() {
      return null;
    },
  };
  return { receiver, drag };
}

test("an unfinished Shift marquee can be cancelled before the next placement click", () => {
  const { receiver, drag } = receiverWithPendingNoteMarquee();

  // The first corner intentionally survives pointerup until a second point is
  // supplied; an outside click must use the cancellation seam instead.
  assert.equal(
    finishRectangle.call(receiver, { type: "pointerup", button: 0, pointerId: 1 }),
    false,
  );
  assert.equal(receiver.gestures.drag, drag);

  assert.equal(receiver.gestures.cancelSelectionGesture(), true);
  assert.equal(receiver.gestures.drag, null);
  assert.equal(receiver.gestures.eventInteraction.drag, null);
  assert.equal(receiver.gestures.cancelSelectionGesture(), false);
});
