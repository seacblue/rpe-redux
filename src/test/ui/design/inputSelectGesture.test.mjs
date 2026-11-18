/** A press decides at release: only an in-place click selects the whole value. */
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

/** A focused numeric field with a press at the origin. */
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
  const { outcome } = run([...armedPress(), { type: "click", ...origin, shiftKey: false }]);
  assert.equal(outcome.selectAll, true);
});

test("the arming is spent by one click", () => {
  const { gesture } = run([...armedPress(), { type: "click", ...origin, shiftKey: false }]);
  assert.equal(
    reduceSelectGesture(gesture, { type: "click", ...origin, shiftKey: false }).selectAll,
    false,
  );
});

test("a non-numeric field never selects on click", () => {
  const events = [
    { type: "focus", selectsValue: false },
    { type: "press", ...origin },
    { type: "click", ...origin, shiftKey: false },
  ];
  assert.equal(run(events).outcome.selectAll, false);
});

test("sub-pixel drift stays a click", () => {
  const { outcome } = run([
    ...armedPress(),
    { type: "click", x: origin.x + 0.5, y: origin.y + 0.25, shiftKey: false },
  ]);
  assert.equal(outcome.selectAll, true);
});

test("travel just under the slop is still a click", () => {
  const { outcome } = run([
    ...armedPress(),
    { type: "click", x: origin.x + SELECT_CLICK_SLOP_PX - 1, y: origin.y, shiftKey: false },
  ]);
  assert.equal(outcome.selectAll, true);
});

test("a click that releases beyond the slop keeps the range the browser drew", () => {
  const { outcome } = run([
    ...armedPress(),
    { type: "click", x: origin.x + SELECT_CLICK_SLOP_PX, y: origin.y, shiftKey: false },
  ]);
  assert.equal(outcome.selectAll, false);
});

test("a drag to the far edge of the field is a range selection", () => {
  const { outcome } = run([
    ...armedPress(),
    { type: "click", x: origin.x + 120, y: origin.y + 20, shiftKey: false },
  ]);
  assert.equal(outcome.selectAll, false);
});

test("dragging backwards is measured the same as forwards", () => {
  const { outcome } = run([
    ...armedPress(),
    { type: "click", x: origin.x - SELECT_CLICK_SLOP_PX, y: origin.y, shiftKey: false },
  ]);
  assert.equal(outcome.selectAll, false);
});

test("a Shift-click extends instead of replacing the selection", () => {
  const { outcome } = run([...armedPress(), { type: "click", ...origin, shiftKey: true }]);
  assert.equal(outcome.selectAll, false);
});

test("blur drops both the arming and the remembered press", () => {
  const { gesture } = run([...armedPress(), { type: "blur" }]);
  assert.deepEqual(gesture, IDLE_SELECT_GESTURE);
});

test("a click with no press behind it lands in place", () => {
  const { outcome } = run([{ type: "click", ...origin, shiftKey: false }], {
    armed: true,
    origin: null,
  });
  assert.equal(outcome.selectAll, true);
});

test("focus arriving after the press keeps the press origin", () => {
  // The browser focuses the field as the mousedown default action, so the
  // order is pointerdown, focus, then the click that ends the press. Losing the
  // origin on focus would turn every drag into an in-place click.
  const { outcome } = run([
    { type: "press", ...origin },
    { type: "focus", selectsValue: true },
    { type: "click", x: origin.x + 40, y: origin.y, shiftKey: false },
  ]);
  assert.equal(outcome.selectAll, false);
});

test("focus arriving after an in-place press still selects on click", () => {
  const { outcome } = run([
    { type: "press", ...origin },
    { type: "focus", selectsValue: true },
    { type: "click", ...origin, shiftKey: false },
  ]);
  assert.equal(outcome.selectAll, true);
});

test("a second press measures from its own origin", () => {
  const first = run([...armedPress(), { type: "click", ...origin, shiftKey: false }]);
  assert.equal(first.outcome.selectAll, true);
  const second = run(
    [
      { type: "press", x: 300, y: 90 },
      { type: "click", x: 302, y: 91, shiftKey: false },
    ],
    { ...IDLE_SELECT_GESTURE, armed: true },
  );
  assert.equal(second.outcome.selectAll, true);
});

test("a press that ends outside the field asks for nothing", () => {
  // The browser dispatches no click when the release lands outside the control,
  // so the gesture must not be left armed by the press alone.
  const { gesture } = run([...armedPress()]);
  assert.equal(gesture.origin?.x, origin.x);
  assert.equal(gesture.armed, true);
});

test("only a number field loses its remembered selection on blur", async () => {
  const { forgetRememberedSelection } =
    await import("../../../design/components/input/useSelectAllOnClick.ts");

  /** A stand-in recording what the helper writes to one field. */
  const makeField = (type) => {
    const calls = [];
    let kind = type;
    return {
      calls,
      value: "1234",
      get type() {
        return kind;
      },
      set type(next) {
        calls.push(`type:${next}`);
        kind = next;
      },
      setSelectionRange(start, end) {
        calls.push(`range:${start}:${end}`);
      },
    };
  };

  const number = makeField("number");
  forgetRememberedSelection(number);
  assert.deepEqual(number.calls, ["type:text", "range:4:4", "type:number"]);

  const text = makeField("text");
  forgetRememberedSelection(text);
  assert.deepEqual(text.calls, []);
});
