/** Event timeline hover emphasis is painted into the original grid stroke. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  grid,
  gridForLine,
} from "../../../frontend/screens/editor/workspace/timeline/drawing/gridDrawing.ts";

test("the event grid paints the hovered horizontal line with the configured colour", () => {
  const strokes = [];
  let strokeStyle = "";
  const context = {
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      strokes.push(strokeStyle);
    },
    fillText() {},
    set strokeStyle(value) {
      strokeStyle = value;
    },
    get strokeStyle() {
      return strokeStyle;
    },
  };
  const receiver = {
    appearance: {
      hoverGuidesEnabled: true,
      gridHighlightColor: "#FFFFFF80",
      subdivisionColors: [],
      barAlpha: 1,
    },
    cache: {
      palette: () => ({
        gridMajor: "#000000",
        gridMinor: "#000000",
        gridSubdivisions: [],
        foreground: "foreground",
        playhead: "playhead",
      }),
    },
    gestures: { cursor: null, eventCursor: { x: 5, y: 76 }, hoverArea: "events" },
    getSession: () => ({ multiLineMode: "events" }),
    viewport: {
      eventsCanvas: { clientWidth: 100 },
      notesCanvas: { clientWidth: 100 },
      lineIndexAt: () => 0,
      factorForLine: () => 1,
      factor: 1,
      tempo: { seconds: (beat) => beat, beat: (seconds) => seconds },
      origin: 0,
      division: 4,
      judgementOffset: 0,
      scaleForArea: () => 1,
    },
  };

  grid.call(receiver, context, 100, 100, 0, { lines: true }, "events");

  assert.ok(strokes.includes("rgba(135,135,135,0.950196)"));
  assert.ok(!strokes.includes("#FFFFFF80"));
});

test("a multi-line event grid keeps the hovered line inside its panel", () => {
  const segments = [];
  const context = {
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    moveTo(x, y) {
      segments.push(["move", x, y]);
    },
    lineTo(x, y) {
      segments.push(["line", x, y]);
    },
    stroke() {},
    fillText() {},
    strokeStyle: "",
  };
  const receiver = {
    appearance: {
      hoverGuidesEnabled: true,
      gridHighlightColor: "#FFFFFF80",
      subdivisionColors: [],
      barAlpha: 1,
    },
    cache: {
      palette: () => ({
        gridMajor: "#000000",
        gridMinor: "#000000",
        gridSubdivisions: [],
        foreground: "foreground",
        playhead: "playhead",
      }),
    },
    gestures: { cursor: null, eventCursor: { x: 60, y: 76 }, hoverArea: "events" },
    getSession: () => ({ multiLineMode: "events" }),
    viewport: {
      eventsCanvas: { clientWidth: 100 },
      notesCanvas: { clientWidth: 100 },
      lineIndexAt: () => 1,
      factorForLine: () => 1,
      factor: 1,
      tempo: { seconds: (beat) => beat, beat: (seconds) => seconds },
      origin: 0,
      division: 4,
      judgementOffset: 0,
      scaleForArea: () => 1,
      verticalForLine: (beat) => 100 - beat,
    },
  };

  gridForLine.call(receiver, context, 50, 30, 100, 0, 1, false, { lines: true }, "events");

  assert.ok(segments.length > 0);
  assert.ok(segments.every(([kind, x]) => (kind === "move" ? x === 50 : x === 80)));
});
