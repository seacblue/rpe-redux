import assert from "node:assert/strict";
import test from "node:test";
import { drawMarqueeRectangle } from "../../../frontend/screens/editor/workspace/timeline/selection/selectionOverlayDrawing.ts";

const palette = {
  selectionNotesFill: "rgba(129, 191, 255, 0.13)",
  selectionNotesStroke: "#81bfff",
  selectionEventsFill: "rgba(129, 191, 255, 0.13)",
  selectionEventsStroke: "#81bfff",
  previewSelectionFill: "rgba(7, 110, 17, 0.22)",
};

function contextSpy() {
  const calls = [];
  return {
    calls,
    lineWidth: 0,
    fillRect(...args) {
      calls.push(["fill", ...args]);
    },
    strokeRect(...args) {
      calls.push(["stroke", ...args]);
    },
    save() {},
    restore() {},
    setLineDash(...args) {
      calls.push(["dash", ...args]);
    },
  };
}

test("notes marquee keeps its filled selection region", () => {
  const context = contextSpy();
  drawMarqueeRectangle(
    context,
    { left: 0, top: 0 },
    { left: 0, top: 0 },
    { x: 10, y: 20 },
    { x: 40, y: 80 },
    "notes",
    palette,
  );

  assert.deepEqual(context.calls, [
    ["fill", 10, 20, 30, 60],
    ["dash", [6, 4]],
    ["stroke", 10, 20, 30, 60],
  ]);
  assert.equal(context.lineWidth, 1.5);
});

test("events marquee keeps its filled selection region", () => {
  const context = contextSpy();
  drawMarqueeRectangle(
    context,
    { left: 0, top: 0 },
    { left: 0, top: 0 },
    { x: 10, y: 20 },
    { x: 40, y: 80 },
    "events",
    palette,
  );

  assert.deepEqual(context.calls, [
    ["fill", 10, 20, 30, 60],
    ["dash", [6, 4]],
    ["stroke", 10, 20, 30, 60],
  ]);
  assert.equal(context.lineWidth, 1.5);
});

test("timeline marquee keeps its fill when dragged in reverse", () => {
  const context = contextSpy();
  drawMarqueeRectangle(
    context,
    { left: 0, top: 0 },
    { left: 0, top: 0 },
    { x: 40, y: 80 },
    { x: 10, y: 20 },
    "notes",
    palette,
  );

  assert.deepEqual(context.calls, [
    ["fill", 10, 20, 30, 60],
    ["dash", [6, 4]],
    ["stroke", 10, 20, 30, 60],
  ]);
});

test("preview marquee normalizes reverse drags and aligns its dashed border", () => {
  const context = contextSpy();
  drawMarqueeRectangle(
    context,
    { left: 0, top: 0 },
    { left: 0, top: 0 },
    { x: 40, y: 80 },
    { x: 10, y: 20 },
    "notes",
    palette,
    true,
  );
  assert.deepEqual(context.calls, [
    ["fill", 10, 20, 30, 60],
    ["dash", [6, 4]],
    ["stroke", 10.5, 20.5, 30, 60],
  ]);
  assert.equal(context.lineWidth, 1);
});

test("preview marquee uses the preview selection fill token", () => {
  const context = contextSpy();
  drawMarqueeRectangle(
    context,
    { left: 0, top: 0 },
    { left: 0, top: 0 },
    { x: 10, y: 20 },
    { x: 40, y: 80 },
    "notes",
    {
      ...palette,
      selectionNotesFill: "rgba(255, 0, 0, 1)",
    },
    true,
  );

  assert.equal(context.fillStyle, "rgba(7, 110, 17, 0.22)");
});
