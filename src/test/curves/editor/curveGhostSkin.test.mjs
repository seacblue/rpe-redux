/**
 * Verifies the curve ghost draws real note skin heads and holds instead of
 * procedural blocks, and that a Hold's head stays on its start anchor.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { drawCurveGhost } from "../../../frontend/screens/editor/workspace/timeline/notes/curveGhostDrawing.ts";

/** A palette with the fields the ghost reads. */
const palette = {
  bottomValue: "#ffffff",
  noteTap: "#111111",
  noteHold: "#222222",
  noteFlick: "#333333",
  noteDrag: "#444444",
  noteFallback: "#555555",
};

/** A beat-to-y projection where larger beats sit higher on screen. */
function vertical(beat) {
  return 1000 - beat * 100;
}

/** A recording 2D context with only the methods the ghost uses. */
function recordingContext() {
  const calls = [];
  const record =
    (name) =>
    (...args) =>
      calls.push({ name, args });
  return {
    calls,
    save: record("save"),
    restore: record("restore"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    stroke: record("stroke"),
    setLineDash: record("setLineDash"),
    fillRect: record("fillRect"),
    strokeRect: record("strokeRect"),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
    filter: "none",
  };
}

/** A receiver exposing the ghost's viewport and a recording skin. */
function receiver(notes, skin) {
  return {
    gestures: {
      curveGhost: () => notes,
    },
    cache: {
      palette: () => palette,
    },
    appearance: { skin },
    viewport: {
      noteHorizontal: (position) => 200 + position,
      noteWidth: () => 60,
      clampNoteHorizontal: (horizontal) => horizontal,
      vertical,
    },
  };
}

test("the ghost renders real skin holds and heads", () => {
  const calls = [];
  const skin = {
    hold: (...args) => {
      calls.push({ kind: "hold", args });
      return true;
    },
    head: (...args) => {
      calls.push({ kind: "head", args });
      return true;
    },
  };
  const notes = [
    {
      type: 2,
      positionX: 0,
      startTime: [1, 0, 1],
      endTime: [1, 1, 4],
    },
    {
      type: 4,
      positionX: 100,
      startTime: [2, 0, 1],
      endTime: [2, 0, 1],
    },
  ];
  const context = recordingContext();

  drawCurveGhost.call(receiver(notes, skin), context);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].kind, "hold");
  assert.equal(calls[0].args[2], 900, "the Hold head stays on the start anchor");
  assert.equal(calls[0].args[3], 875, "the Hold body reaches the end anchor");
  assert.equal(calls[1].kind, "head");
  assert.equal(calls[1].args[3], 800);
  assert.equal(context.filter, "saturate(0.58) brightness(1.12)");
  assert.equal(
    context.calls.filter((call) => call.name === "fillRect").length,
    0,
    "no procedural note blocks are painted when the skin is available",
  );
});

test("a missing skin falls back to translucent geometry", () => {
  const notes = [
    {
      type: 2,
      positionX: 0,
      startTime: [1, 0, 1],
      endTime: [1, 1, 4],
    },
  ];
  const context = recordingContext();

  drawCurveGhost.call(receiver(notes, null), context);

  const fills = context.calls.filter((call) => call.name === "fillRect");
  assert.ok(fills.length >= 2, "the body and the start cap are drawn");
  assert.equal(fills[0].args[1], 875, "the body begins at the later end beat");
  assert.equal(fills[1].args[1], 897, "the cap sits on the start anchor");
});
