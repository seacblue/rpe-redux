/** Merged-note lane rendering keeps vertical guides visible around the pointer. */
import assert from "node:assert/strict";
import test from "node:test";
import { drawNoteLanes } from "../../../frontend/screens/editor/workspace/timeline/notes/noteLaneDrawing.ts";

test("merged note lanes reveal vertical guides around the pointer", () => {
  let strokes = 0;
  const context = {
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      strokes += 1;
    },
    lineWidth: 1,
    strokeStyle: "",
  };
  const receiver = {
    notesBackdrop: {},
    cache: { canvasLayer: () => null },
    appearance: {
      hoverGuidesEnabled: true,
      nearbyGuidesOnly: true,
      verticalGridColor: "#111111",
      verticalGridCenterColor: "#222222",
      gridHighlightColor: "#FFFFFF80",
    },
    gestures: { hoverArea: "notes", cursor: { x: 50, y: 50 } },
    getSession: () => ({
      notesMode: "multi_merged",
      lineIndex: 1,
      targetLineIndices: [1, 2],
    }),
    viewport: {
      gridCount: 5,
      cameraX: 0,
      panelWidth: () => 100,
      noteInset: () => 0,
      panelCount: () => 1,
      panelStride: () => 100,
      multiLineViewportOffset: () => 0,
      visiblePanelRange: () => [0, 0],
      lineIndexAt: () => 2,
    },
  };

  drawNoteLanes(receiver, context, 100, 100);

  assert.ok(strokes > 0);
});

test("note lanes extend outside the authored range at the same scale", () => {
  const positions = [];
  const styles = [];
  const context = {
    beginPath() {},
    moveTo(x) {
      positions.push(x);
      styles.push(this.strokeStyle);
    },
    lineTo() {},
    stroke() {},
    lineWidth: 1,
    strokeStyle: "",
  };
  const receiver = {
    notesBackdrop: {},
    cache: { canvasLayer: () => null },
    appearance: {
      hoverGuidesEnabled: true,
      nearbyGuidesOnly: false,
      verticalGridColor: "#111111",
      verticalGridCenterColor: "#222222",
      gridHighlightColor: "#FFFFFF80",
    },
    gestures: { hoverArea: "", cursor: null },
    getSession: () => ({
      notesMode: "notes",
      lineIndex: 1,
      targetLineIndices: [1],
    }),
    viewport: {
      gridCount: 5,
      cameraX: 675,
      panelWidth: () => 100,
      noteInset: () => 0,
      panelCount: () => 1,
      panelStride: () => 100,
      multiLineViewportOffset: () => 0,
      visiblePanelRange: () => [0, 0],
      lineIndexAt: () => 0,
    },
  };

  drawNoteLanes(receiver, context, 100, 100);

  assert.deepEqual(positions, [0, 25, 50, 75, 100]);
  assert.equal(styles[0], "#222222");
});
