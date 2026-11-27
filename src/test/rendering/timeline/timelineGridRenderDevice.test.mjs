/** Canvas2D grid fallback keeps horizontal guide geometry inside its submitted rectangles. */
import assert from "node:assert/strict";
import test from "node:test";
import { TimelineGridRenderDevice } from "../../../frontend/screens/editor/canvas/timelineGridRenderDevice.ts";

test("Canvas2D grid fallback fills the exact horizontal guide bounds", () => {
  const rectangles = [];
  const strokes = [];
  const context = {
    globalAlpha: 1,
    fillStyle: "",
    lineWidth: 1,
    strokeStyle: "",
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    fillRect(...args) {
      rectangles.push(args);
    },
    moveTo(...args) {
      strokes.push(["move", ...args]);
    },
    lineTo(...args) {
      strokes.push(["line", ...args]);
    },
    stroke() {
      strokes.push(["stroke", this.lineWidth]);
    },
  };

  new TimelineGridRenderDevice().render({
    context,
    commands: [
      {
        kind: "fillRect",
        x: 2,
        y: 28,
        width: 96,
        height: 2,
        color: "#343949",
        alpha: 0.9,
      },
    ],
  });

  assert.deepEqual(rectangles, [[2, 28, 96, 2]]);
  assert.deepEqual(strokes, []);
});
