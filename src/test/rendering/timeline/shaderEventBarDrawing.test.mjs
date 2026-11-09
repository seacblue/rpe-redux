/** Verify that shader events use the same skin event bar as every other event track. */
import assert from "node:assert/strict";
import test from "node:test";
import { drawShaderEvents } from "../../../frontend/screens/editor/workspace/timeline/events/eventOverlayDrawing.ts";

const palette = {
  overlayInvalidFill: "#ff000080",
  eventShaderText: "#ffffff",
  selectionHighlight: "#00ff0040",
};

function fakeContext() {
  const fills = [];
  const texts = [];
  return {
    fills,
    texts,
    globalAlpha: 1,
    fillStyle: "",
    font: "",
    textAlign: "left",
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    fillRect(...args) {
      fills.push({ style: this.fillStyle, args });
    },
    fillText(text, x, y) {
      texts.push({ text, x, y });
    },
  };
}

test("shader events draw the skin event bar and keep the shader label", () => {
  const bars = [];
  const context = fakeContext();
  const receiver = {
    appearance: {
      eventOpacity: 1,
      eventValueFontSize: 12,
      skin: {
        eventBar(_context, centerX, centerY, width, height) {
          bars.push({ centerX, centerY, width, height });
          return true;
        },
      },
    },
    cache: {
      palette: () => palette,
      shaderLane: () => ({ lane: 0, count: 1 }),
    },
    viewport: {
      eventColumnBounds: () => ({ x: 100, width: 80 }),
      eventVertical: (beat) => 400 - beat * 10,
    },
    gestures: { eventRects: [] },
    getSession: () => ({ eventSelection: new Set(["paintEvents:0"]) }),
    eventBatch: { add: () => false },
  };
  const entries = [
    {
      index: 0,
      item: { startTime: [1, 0, 1], endTime: [2, 0, 1], order: 1 },
      start: 1,
      end: 2,
    },
  ];

  drawShaderEvents.call(receiver, context, entries, 3, 200, 400);

  assert.deepEqual(bars, [{ centerX: 140, centerY: 385, width: 80, height: 10 }]);
  assert.deepEqual(receiver.gestures.eventRects, [
    { x: 100, y: 380, width: 80, height: 10, index: 0, type: "paintEvents" },
  ]);
  assert.ok(context.texts.some((entry) => entry.text === "chromatic"));
  assert.ok(
    context.fills.some(
      (entry) => entry.style === palette.selectionHighlight && entry.args[0] === 100,
    ),
    "the selected shader event keeps the shared selection tint",
  );
});
