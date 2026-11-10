/** Verify that an unplaced event preview uses the event-bar skin at half opacity. */
import assert from "node:assert/strict";
import test from "node:test";
import { drawPendingEvent } from "../../../frontend/screens/editor/workspace/timeline/events/eventOverlayDrawing.ts";

function fakeContext() {
  const stack = [];
  return {
    globalAlpha: 1,
    save() {
      stack.push(this.globalAlpha);
    },
    restore() {
      this.globalAlpha = stack.pop() ?? 1;
    },
  };
}

function receiver({ batchAccept, skin }) {
  const session = {
    chart: { judgeLineList: [] },
    lineIndex: 0,
    eventLayer: 0,
    multiLineActive: false,
    multiLineMode: "events",
  };
  return {
    appearance: { eventOpacity: 0.8, multiLineNonCurrentOpacity: 0.5, skin },
    eventBatch: {
      add() {
        return batchAccept;
      },
    },
    getSession: () => session,
    gestures: { eventCursor: null },
    viewport: {
      eventTypesForLine: () => ["moveXEvents"],
      eventVertical: (beat) => 400 - beat * 10,
      panelWidth: (width) => width,
      panelIndex: () => 0,
      panelStride: (width) => width,
      multiLineViewportOffset: () => 0,
      eventInset: () => 0,
      eventBarWidth: 0.82,
    },
  };
}

const pending = { type: "moveXEvents", beat: 2, lineIndex: 0 };

test("the pending event joins the event-bar batch at half the committed opacity", () => {
  const context = fakeContext();
  const calls = [];
  const target = receiver({
    batchAccept: true,
    skin: null,
  });
  target.eventBatch.add = (rectangle, alpha) => {
    calls.push({ rectangle, alpha, contextAlpha: context.globalAlpha });
    return true;
  };

  drawPendingEvent.call(target, context, pending, 300);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].alpha, 0.5);
  assert.equal(calls[0].contextAlpha, 0.4);
  assert.equal(calls[0].rectangle.width, 300 * 0.82);
  assert.equal(calls[0].rectangle.height, 2);
  assert.equal(context.globalAlpha, 1);
});

test("the canvas fallback draws the skin event bar at half opacity", () => {
  const context = fakeContext();
  const bars = [];
  const skin = {
    eventBar(_context, centerX, centerY, width, height) {
      bars.push({ centerX, centerY, width, height, alpha: context.globalAlpha });
      return true;
    },
  };
  const target = receiver({ batchAccept: false, skin });

  drawPendingEvent.call(target, context, pending, 300);

  assert.equal(bars.length, 1);
  assert.equal(bars[0].width, 300 * 0.82);
  assert.equal(bars[0].height, 2);
  assert.equal(bars[0].alpha, 0.4);
  assert.equal(context.globalAlpha, 1);
});
