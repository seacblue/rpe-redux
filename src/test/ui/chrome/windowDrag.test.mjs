/**
 * The title row is the window's drag surface without becoming a click surface.
 *
 * These tests drive the pure gesture reducer behind `useTitleBarWindowDrag`
 * through taps, threshold crossings, releases, and double presses. They pin the
 * two contracts the row has to keep: a tap stays a tap for the bar's buttons,
 * and a drag starts the window move exactly once and ends by asking the host to
 * swallow the click that would otherwise reach the content below.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  IDLE_WINDOW_DRAG,
  WINDOW_DRAG_EXCLUDED_SELECTOR,
  WINDOW_DRAG_THRESHOLD_PX,
  WINDOW_DOUBLE_PRESS_MS,
  isWindowDoublePress,
  reduceWindowDrag,
} from "../../../frontend/chrome/topbar/windowDrag.ts";

/** Applies events in order and returns the final gesture and last outcome. */
function run(events, initial = IDLE_WINDOW_DRAG) {
  let gesture = initial;
  let outcome = null;
  for (const event of events) {
    outcome = reduceWindowDrag(gesture, event);
    gesture = outcome.gesture;
  }
  return { gesture, outcome };
}

/** One press event at the given client point. */
function press(x = 100, y = 20, pointerId = 1) {
  return { type: "press", pointerId, x, y };
}

/** One move event at the given client point. */
function move(x, y, pointerId = 1) {
  return { type: "move", pointerId, x, y };
}

/** One release event for the given pointer. */
function release(pointerId = 1) {
  return { type: "release", pointerId };
}

test("a press alone never starts the window move", () => {
  const { gesture, outcome } = run([press()]);
  assert.equal(outcome.beginDrag, false);
  assert.equal(gesture.dragging, false);
  assert.equal(gesture.pointerId, 1);
});

test("movement below the threshold keeps the press a tap", () => {
  const { outcome } = run([press(100, 20), move(100 + WINDOW_DRAG_THRESHOLD_PX - 1, 20)]);
  assert.equal(outcome.beginDrag, false);
});

test("crossing the threshold starts the window move exactly once", () => {
  const below = run([press(100, 20), move(100, 20 + WINDOW_DRAG_THRESHOLD_PX - 1)]);
  assert.equal(below.outcome.beginDrag, false);

  const across = reduceWindowDrag(below.gesture, move(100, 20 + WINDOW_DRAG_THRESHOLD_PX));
  assert.equal(across.beginDrag, true);
  assert.equal(across.gesture.dragging, true);

  const further = reduceWindowDrag(across.gesture, move(100, 120));
  assert.equal(further.beginDrag, false);
  assert.equal(further.gesture.dragging, true);
});

test("a tap releases without asking for a post-drag click suppression", () => {
  const { gesture, outcome } = run([press(100, 20), move(101, 21), release()]);
  assert.equal(outcome.endDrag, false);
  assert.deepEqual(gesture, IDLE_WINDOW_DRAG);
});

test("a drag releases into the idle gesture and asks for click suppression", () => {
  const { gesture, outcome } = run([press(100, 20), move(100, 80), release()]);
  assert.equal(outcome.endDrag, true);
  assert.deepEqual(gesture, IDLE_WINDOW_DRAG);
});

test("events from another pointer cannot steer or end the gesture", () => {
  const started = run([press(100, 20), move(100, 80)]);
  const otherMove = reduceWindowDrag(started.gesture, move(400, 400, 2));
  assert.deepEqual(otherMove.gesture, started.gesture);
  assert.equal(otherMove.beginDrag, false);

  const otherRelease = reduceWindowDrag(started.gesture, release(2));
  assert.deepEqual(otherRelease.gesture, started.gesture);
  assert.equal(otherRelease.endDrag, false);
});

test("a cancel ends a drag and asks for click suppression", () => {
  const started = run([press(100, 20), move(100, 80)]);
  const cancelled = reduceWindowDrag(started.gesture, { type: "cancel" });
  assert.equal(cancelled.endDrag, true);
  assert.deepEqual(cancelled.gesture, IDLE_WINDOW_DRAG);
});

test("a double press is two nearby presses inside the double-press window", () => {
  assert.equal(isWindowDoublePress(1000, 300, 20, 1000 + WINDOW_DOUBLE_PRESS_MS, 301, 21), true);
  assert.equal(
    isWindowDoublePress(1000, 300, 20, 1000 + WINDOW_DOUBLE_PRESS_MS + 1, 301, 21),
    false,
  );
  assert.equal(isWindowDoublePress(1000, 300, 20, 1100, 340, 60), false);
  assert.equal(isWindowDoublePress(0, 300, 20, 1100, 300, 20), false);
});

test("interactive title-row descendants keep their own pointer behavior", () => {
  for (const selector of [
    "button",
    "a",
    "[role='menuitem']",
    "[role='menu']",
    "[role='dialog']",
    "[data-window-drag-exclude]",
  ]) {
    assert.ok(
      WINDOW_DRAG_EXCLUDED_SELECTOR.includes(selector),
      `${selector} must keep its own pointer behavior`,
    );
  }
});
