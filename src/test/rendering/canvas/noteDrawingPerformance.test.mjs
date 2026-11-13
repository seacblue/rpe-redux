/** Focused contracts for note drawing's per-pass palette reuse. */
import assert from "node:assert/strict";
import test from "node:test";
import { createNote } from "../../../core/global/chart/chart.ts";
import { drawNote } from "../../../frontend/screens/editor/workspace/timeline/notes/noteDrawing.ts";

test("note drawing reuses the enclosing palette instead of reading it per note", () => {
  const palette = {
    noteTap: "tap",
    noteHold: "hold",
    noteFlick: "flick",
    noteDrag: "drag",
    noteFallback: "fallback",
    selectionHighlightStroke: "selected",
    remoteSelectionHighlight: "remote",
  };
  let paletteReads = 0;
  const receiver = {
    appearance: { noteOpacity: 1, skin: undefined },
    cache: {
      palette() {
        paletteReads++;
        return palette;
      },
    },
    noteBatch: {
      addHead() {
        return true;
      },
    },
    noteSolidBatch: { addHead() {} },
  };
  const context = { globalAlpha: 1, fillStyle: "" };
  drawNote.call(receiver, context, {
    palette,
    note: createNote(1, 0, 0),
    horizontal: 10,
    vertical: 20,
    endVertical: 20,
    noteWidth: 40,
    height: 100,
  });
  assert.equal(paletteReads, 0);
  assert.equal(context.fillStyle, "tap");
});
