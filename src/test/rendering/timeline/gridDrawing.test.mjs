/** Event timeline hover emphasis is painted into the original grid stroke. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  grid,
  gridForLine,
  visibleGridTicks,
} from "../../../frontend/screens/editor/workspace/timeline/drawing/gridDrawing.ts";
import {
  horizontalGuideHoverOpacity,
  isPixelGuideHovered,
  strokeVerticalGuide,
  verticalGuidePixelOpacity,
} from "../../../frontend/screens/editor/workspace/timeline/drawing/timelineHoverGuides.ts";

test("horizontal guide hover fades smoothly while staying uniform across the line", () => {
  assert.equal(horizontalGuideHoverOpacity(100, 100), 1);
  assert.ok(horizontalGuideHoverOpacity(100, 172) > 0);
  assert.equal(horizontalGuideHoverOpacity(100, 244), 0);
  assert.equal(horizontalGuideHoverOpacity(100, null), 0);
});

test("nearby horizontal guides colour only the nearest snapped line", () => {
  const strokes = [];
  const context = {
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: "",
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      strokes.push({ color: this.strokeStyle, alpha: this.globalAlpha });
    },
    fillText() {},
  };
  const receiver = {
    appearance: {
      hoverGuidesEnabled: true,
      nearbyGuidesOnly: true,
      gridHighlightColor: "#FFFFFF80",
      subdivisionColors: [],
      barAlpha: 1,
      barWidth: 3,
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
    gestures: { cursor: { x: 20, y: 100 }, eventCursor: null, hoverArea: "notes" },
    getSession: () => ({ multiLineMode: "notes" }),
    viewport: {
      notesCanvas: { clientWidth: 100 },
      eventsCanvas: { clientWidth: 100 },
      lineIndexAt: () => 0,
      factorForLine: () => 1,
      factor: 1,
      tempo: { seconds: (beat) => beat, beat: (seconds) => seconds },
      origin: 0,
      division: 4,
      judgementOffset: 0,
      scaleForArea: () => 100,
      verticalForLine: (beat, _lineIndex, height) => height - beat * 20,
    },
  };

  gridForLine.call(
    receiver,
    context,
    0,
    100,
    100,
    0,
    0,
    false,
    { lines: true, labels: false, playhead: false },
    "notes",
  );

  assert.ok(strokes.some(({ color, alpha }) => color === "rgba(128,128,128,1)" && alpha === 1));
  assert.ok(strokes.some(({ color }) => color === "#000000"));
});

test("timeline grids keep every visible horizontal guide", () => {
  assert.deepEqual(
    visibleGridTicks(0, 12, 1, null),
    Array.from({ length: 13 }, (_, i) => i),
  );
});

test("a constant-tempo division-six grid keeps evenly spaced horizontal guides", () => {
  const positions = [];
  const context = {
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: "",
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    moveTo(_x, y) {
      positions.push(y);
    },
    lineTo() {},
    stroke() {},
  };
  const receiver = {
    appearance: {
      hoverGuidesEnabled: true,
      nearbyGuidesOnly: false,
      gridHighlightColor: "#FFFFFF80",
      subdivisionColors: [],
      barAlpha: 1,
      barWidth: 3,
    },
    cache: {
      palette: () => ({
        gridMajor: "#FFFFFF",
        gridMinor: "#000000",
        gridSubdivisions: [],
        foreground: "foreground",
        playhead: "playhead",
      }),
    },
    gestures: { cursor: null, eventCursor: null, hoverArea: undefined },
    getSession: () => ({ multiLineMode: "notes" }),
    viewport: {
      notesCanvas: { clientWidth: 100 },
      eventsCanvas: { clientWidth: 100 },
      lineIndexAt: () => 0,
      factorForLine: () => 1,
      factor: 1,
      tempo: { seconds: (beat) => beat * 0.5, beat: (seconds) => seconds * 2 },
      origin: 0,
      division: 6,
      judgementOffset: 0,
      scaleForArea: () => 100,
      verticalForLine: (beat, _lineIndex, height) => height - beat * 50,
    },
  };

  gridForLine.call(
    receiver,
    context,
    50,
    30,
    200,
    0,
    0,
    false,
    { lines: true, labels: false, playhead: false },
    "notes",
  );

  positions.sort((left, right) => left - right);
  assert.equal(positions.length, 25);
  const gaps = positions.slice(1).map((position, index) => position - positions[index]);
  assert.ok(gaps.every((gap) => Math.abs(gap - 50 / 6) < 1e-6));
});

test("nearby-only multi-line grids submit every horizontal tick in every panel", () => {
  const rectangles = [];
  const batch = {
    isActive: () => true,
    addRect(...args) {
      rectangles.push(args);
    },
  };
  const context = {
    globalAlpha: 1,
    lineWidth: 1,
    font: "",
    fillStyle: "",
    strokeStyle: "",
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText() {},
  };
  const receiver = {
    appearance: {
      hoverGuidesEnabled: true,
      nearbyGuidesOnly: true,
      gridHighlightColor: "#FFFFFF80",
      subdivisionColors: [],
      barAlpha: 1,
      barWidth: 3,
    },
    cache: {
      palette: () => ({
        gridMajor: "#FFFFFF",
        gridMinor: "#000000",
        gridSubdivisions: [],
        foreground: "foreground",
        playhead: "playhead",
      }),
    },
    gestures: { cursor: { x: 25, y: 100 }, eventCursor: null, hoverArea: "notes" },
    viewport: {
      notesCanvas: { clientWidth: 300 },
      eventsCanvas: { clientWidth: 300 },
      lineIndexAt: () => 0,
      factorForLine: () => 1,
      factor: 1,
      tempo: { seconds: (beat) => beat * 0.5, beat: (seconds) => seconds * 2 },
      origin: 0,
      division: 6,
      judgementOffset: 0,
      scaleForArea: () => 100,
      verticalForLine: (beat, _lineIndex, height) => height - beat * 50,
    },
    notesGridBatch: batch,
    eventsGridBatch: batch,
    notesPlayheadBatch: { isActive: () => false },
    eventsPlayheadBatch: { isActive: () => false },
  };

  for (const left of [0, 100, 200]) {
    gridForLine.call(
      receiver,
      context,
      left,
      100,
      200,
      0,
      0,
      false,
      { lines: true, labels: false, playhead: false },
      "notes",
    );
  }

  assert.equal(rectangles.length, 75);
  assert.deepEqual(
    rectangles.reduce((counts, [left]) => {
      counts.set(left, (counts.get(left) ?? 0) + 1);
      return counts;
    }, new Map()),
    new Map([
      [0, 25],
      [100, 25],
      [200, 25],
    ]),
  );
  assert.ok(rectangles.every(([, , , , , alpha]) => alpha > 0));
});

test("multi-line horizontal guides keep canvas-pixel thickness as panels narrow", () => {
  const rectangles = [];
  const batch = {
    isActive: () => true,
    addRect(...args) {
      rectangles.push(args);
    },
  };
  const context = {
    globalAlpha: 1,
    lineWidth: 1,
    font: "",
    fillStyle: "",
    strokeStyle: "",
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText() {},
  };
  const receiver = {
    appearance: {
      hoverGuidesEnabled: true,
      nearbyGuidesOnly: false,
      gridHighlightColor: "#FFFFFF80",
      subdivisionColors: [],
      barAlpha: 1,
      barWidth: 3,
    },
    cache: {
      palette: () => ({
        gridMajor: "#FFFFFF",
        gridMinor: "#000000",
        gridSubdivisions: [],
        foreground: "foreground",
        playhead: "playhead",
      }),
    },
    gestures: { cursor: null, eventCursor: null, hoverArea: undefined },
    getSession: () => ({ multiLineMode: "notes" }),
    viewport: {
      notesCanvas: { clientWidth: 600 },
      eventsCanvas: { clientWidth: 600 },
      lineIndexAt: () => 0,
      factorForLine: () => 1,
      factor: 1,
      tempo: { seconds: (beat) => beat, beat: (seconds) => seconds },
      origin: 0,
      division: 4,
      judgementOffset: 0,
      scaleForArea: () => 100,
      verticalForLine: (beat, _lineIndex, height) => height - beat * 25,
    },
    notesGridBatch: batch,
    eventsGridBatch: batch,
    notesPlayheadBatch: { isActive: () => false },
    eventsPlayheadBatch: { isActive: () => false },
  };

  for (const panelWidth of [600, 282, 192]) {
    gridForLine.call(
      receiver,
      context,
      0,
      panelWidth,
      200,
      0,
      0,
      false,
      { lines: true, labels: false, playhead: false },
      "notes",
    );
  }

  const heights = [...new Set(rectangles.map(([, , , height]) => height))];
  assert.deepEqual(heights, [1.875]);
});

test("vertical guide hover uses screen-pixel distance", () => {
  assert.equal(isPixelGuideHovered(100, 109), true);
  assert.equal(isPixelGuideHovered(100, 116), false);
  assert.equal(isPixelGuideHovered(100, null), false);
});

test("nearby vertical guides reveal only pixels inside the radial range", () => {
  const pointer = { x: 100, y: 100 };
  assert.equal(verticalGuidePixelOpacity(100, 100, pointer), 1);
  assert.ok(verticalGuidePixelOpacity(60, 100, pointer) > 0);
  assert.equal(verticalGuidePixelOpacity(300, 100, pointer), 0);
});

test("nearby vertical guides submit every pixel segment, including transparent ones", () => {
  const alphas = [];
  const context = {
    globalAlpha: 1,
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      alphas.push(this.globalAlpha);
    },
  };

  strokeVerticalGuide(context, 100, 300, { x: 100, y: 150 }, true);

  assert.equal(alphas.length, 75);
  assert.ok(alphas.some((alpha) => alpha === 0));
  assert.ok(alphas.some((alpha) => alpha > 0));
});

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
      hoverGuideSpreadEnabled: true,
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

  assert.ok(strokes.includes("rgba(128,128,128,1)"));
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
      hoverGuideSpreadEnabled: true,
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
