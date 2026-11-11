/**
 * Verifies the quick curve panel's drag bounds: the title-row drag cannot put
 * the card over the window title row or outside the window, while the toolbar
 * below it stays reachable.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { clampDraggedPanel } from "../../../frontend/screens/editor/inspector/curveNotes/curveQuickPlacement.ts";

const size = { width: 400, height: 181 };
const windowSize = { width: 1424, height: 958 };

test("dragging up stops below the window title row", () => {
  assert.deepEqual(clampDraggedPanel(300, -500, size, 40, windowSize), {
    left: 300,
    top: 40,
  });
});

test("dragging past the edges keeps the whole card in the window", () => {
  assert.deepEqual(clampDraggedPanel(-80, 2000, size, 40, windowSize), {
    left: 0,
    top: 777,
  });
  assert.deepEqual(clampDraggedPanel(5000, 100, size, 40, windowSize), {
    left: 1024,
    top: 100,
  });
});

test("a hidden workspace falls back to the window's own top edge", () => {
  assert.deepEqual(clampDraggedPanel(300, -10, size, 0, windowSize), {
    left: 300,
    top: 0,
  });
});
