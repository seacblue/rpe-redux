/** Verifies the pointer routing that lets a placement click pass a control ball. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  batchPlacementPending,
  forwardBallPointer,
  routePendingPlacement,
} from "../../../frontend/screens/editor/workspace/stage/batchControls/batchControlTimeline.ts";

/** Build the timeline surface the routing helpers read. */
function timelineForRouting() {
  const calls = { down: 0, eventDown: 0, changed: 0 };
  const timeline = {
    notesCanvas: { clientWidth: 200, clientHeight: 300 },
    eventsCanvas: { clientWidth: 200, clientHeight: 300 },
    down() {
      calls.down += 1;
    },
    changed() {
      calls.changed += 1;
    },
    viewport: {
      point: (event, canvas) => ({ x: event.clientX - canvas.clientWidth, y: event.clientY }),
      lineIndexAt: () => 3,
    },
    gestures: {
      cursor: null,
      eventCursor: null,
      cursorLineIndex: undefined,
      hoverArea: undefined,
      clipboardPointer: null,
      pendingHold: null,
      eventInteraction: {
        pending: null,
        down() {
          calls.eventDown += 1;
        },
      },
    },
  };
  return { timeline, calls };
}

/** A press that can prove its default was cancelled. */
function press(overrides = {}) {
  return {
    button: 0,
    clientX: 10,
    clientY: 20,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    ...overrides,
  };
}

test("a pending Hold or event placement is the only pending placement", () => {
  const { timeline } = timelineForRouting();
  assert.equal(batchPlacementPending(timeline), false);
  timeline.gestures.pendingHold = { beat: 0, positionX: 0, lineIndex: 0 };
  assert.equal(batchPlacementPending(timeline), true);
  timeline.gestures.pendingHold = null;
  timeline.gestures.eventInteraction.pending = { type: "alphaEvents", beat: 0 };
  assert.equal(batchPlacementPending(timeline), true);
});

test("a ball press finishes a pending Hold on the note field", () => {
  const { timeline, calls } = timelineForRouting();
  timeline.gestures.pendingHold = { beat: 0, positionX: 0, lineIndex: 0 };
  const event = press();

  assert.equal(routePendingPlacement(timeline, "notes", event), true);
  assert.equal(calls.down, 1);
  assert.equal(calls.eventDown, 0);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

test("a ball press finishes a pending event on the event field", () => {
  const { timeline, calls } = timelineForRouting();
  timeline.gestures.eventInteraction.pending = { type: "alphaEvents", beat: 0 };
  const event = press();

  assert.equal(routePendingPlacement(timeline, "events", event), true);
  assert.equal(calls.eventDown, 1);
  assert.equal(calls.down, 0);
  assert.equal(event.defaultPrevented, true);
});

test("a ball press with no placement pending starts a batch drag", () => {
  const { timeline, calls } = timelineForRouting();
  const event = press();

  assert.equal(routePendingPlacement(timeline, "notes", event), false);
  assert.equal(calls.down, 0);
  assert.equal(calls.eventDown, 0);
  assert.equal(event.defaultPrevented, false);
});

test("pointer movement over a ball keeps the note cursor current", () => {
  const { timeline, calls } = timelineForRouting();
  const previousElement = globalThis.Element;
  const previousHtmlElement = globalThis.HTMLElement;
  class FakeElement {}
  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  try {
    const group = Object.assign(new FakeElement(), { dataset: { area: "notes" } });
    const target = Object.assign(new FakeElement(), { closest: () => group });
    forwardBallPointer(timeline, { target, clientX: 50, clientY: 80 });

    assert.deepEqual(timeline.gestures.cursor, { x: -150, y: 80 });
    assert.equal(timeline.gestures.cursorLineIndex, 3);
    assert.equal(timeline.gestures.hoverArea, "notes");
    assert.deepEqual(timeline.gestures.clipboardPointer, { x: -150, y: 80 });
    assert.equal(calls.changed, 1);
  } finally {
    globalThis.Element = previousElement;
    globalThis.HTMLElement = previousHtmlElement;
  }
});
