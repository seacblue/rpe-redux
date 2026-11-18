/** A press that travels is a range selection, not the field's select-all click. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  IDLE_SELECT_GESTURE,
  reduceSelectGesture,
  SELECT_CLICK_SLOP_PX,
  selectsValueOnClick,
} from "../../../design/components/input/selectGesture.ts";

const origin = { x: 120, y: 40 };

/** Apply events in order and return the final state with the last outcome. */
function run(events, gesture = IDLE_SELECT_GESTURE) {
  let state = gesture;
  let outcome;
  for (const event of events) {
    outcome = reduceSelectGesture(state, event);
    state = outcome.gesture;
  }
  return { gesture: state, outcome };
}

/** The events of a focused numeric field that presses at the origin. */
const armedPress = () => [
  { type: "focus", selectsValue: true },
  { type: "press", ...origin },
];

test("only a numeric field arms the select-all click", () => {
  assert.equal(selectsValueOnClick("number"), true);
  assert.equal(selectsValueOnClick("text"), false);
  assert.equal(selectsValueOnClick("search"), false);
  assert.equal(selectsValueOnClick(undefined), false);
});

test("a click that releases where it landed selects the whole value", () => {
  const { outcome } = run([
    ...armedPress(),
    { type: "release", ...origin },
    { type: "click", shiftKey: false },
  ]);
  assert.equal(outcome.selectAll, true);
});

test("the arming is spent by one click", () => {
  const { gesture } = run([
    ...armedPress(),
    { type: "release", ...origin },
    { type: "click", shiftKey: false },
  ]);
  assert.equal(reduceSelectGesture(gesture, { type: "click", shiftKey: false }).selectAll, false);
});

test("a non-numeric field never selects on click", () => {
  const events = [
    { type: "focus", selectsValue: false },
    { type: "press", ...origin },
    { type: "release", ...origin },
    { type: "click", shiftKey: false },
  ];
  assert.equal(run(events).outcome.selectAll, false);
});

test("sub-pixel drift stays a click", () => {
  const { outcome } = run([
    ...armedPress(),
    { type: "release", x: origin.x + 0.5, y: origin.y + 0.25 },
    { type: "click", shiftKey: false },
  ]);
  assert.equal(outcome.selectAll, true);
});

test("travel just under the slop is still a click", () => {
  const { outcome } = run([
    ...armedPress(),
    { type: "release", x: origin.x + SELECT_CLICK_SLOP_PX - 1, y: origin.y },
    { type: "click", shiftKey: false },
  ]);
  assert.equal(outcome.selectAll, true);
});

test("a drag beyond the slop keeps the range the browser drew", () => {
  const { outcome } = run([
    ...armedPress(),
    { type: "move", x: origin.x + SELECT_CLICK_SLOP_PX, y: origin.y },
    { type: "release", x: origin.x + SELECT_CLICK_SLOP_PX, y: origin.y },
    { type: "click", shiftKey: false },
  ]);
  assert.equal(outcome.selectAll, false);
});

test("a drag that leaves the field releases the window follower", () => {
  const { outcome } = run([...armedPress(), { type: "move", x: origin.x + 120, y: origin.y }]);
  assert.equal(outcome.release, true);
});

test("a release outside the field after a drag never re-arms the click", () => {
  const { gesture } = run([
    ...armedPress(),
    { type: "move", x: origin.x + 120, y: origin.y },
    { type: "release", x: origin.x + 240, y: origin.y },
  ]);
  assert.equal(reduceSelectGesture(gesture, { type: "click", shiftKey: false }).selectAll, false);
});

test("a Shift-click extends instead of replacing the selection", () => {
  const { outcome } = run([
    ...armedPress(),
    { type: "release", ...origin },
    { type: "click", shiftKey: true },
  ]);
  assert.equal(outcome.selectAll, false);
});

test("blur drops both the arming and the followed press", () => {
  const { gesture } = run([...armedPress(), { type: "blur" }]);
  assert.deepEqual(gesture, IDLE_SELECT_GESTURE);
});

test("moving without a press changes nothing", () => {
  const armed = { ...IDLE_SELECT_GESTURE, armed: true };
  const { outcome } = run([{ type: "move", x: origin.x + 200, y: origin.y }], armed);
  assert.equal(outcome.gesture, armed);
  assert.equal(outcome.release, false);
});

test("a release without a press changes nothing", () => {
  const armed = { ...IDLE_SELECT_GESTURE, armed: true };
  const { outcome } = run([{ type: "release", x: origin.x + 200, y: origin.y }], armed);
  assert.equal(outcome.gesture, armed);
  assert.equal(outcome.release, false);
});

test("a press that returns near its origin is still a range", () => {
  const { gesture } = run([
    ...armedPress(),
    { type: "move", x: origin.x + 120, y: origin.y + 20 },
    { type: "release", x: origin.x + 1, y: origin.y + 1 },
  ]);
  assert.equal(gesture.dragged, true);
  assert.equal(reduceSelectGesture(gesture, { type: "click", shiftKey: false }).selectAll, false);
});

test("a second press starts a fresh drag measurement", () => {
  const state = run([
    ...armedPress(),
    { type: "move", x: origin.x + 120, y: origin.y },
    { type: "release", x: origin.x + 120, y: origin.y },
  ]).gesture;
  const pressed = reduceSelectGesture(state, { type: "press", ...origin }).gesture;
  assert.equal(pressed.dragged, false);
});
