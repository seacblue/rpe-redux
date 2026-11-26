/** Event timeline hover emphasis is painted into the original grid stroke. */
/* eslint-disable max-lines -- grid geometry and panel-label fixtures share one test seam. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  drawMultiLineBeatLabels,
  drawMultiLinePanelLabels,
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
import { t } from "../../../i18n/index.ts";

test("horizontal guide hover fades smoothly while staying uniform across the line", () => {
  assert.equal(horizontalGuideHoverOpacity(100, 100), 1);
  assert.ok(horizontalGuideHoverOpacity(100, 172) > 0);
  assert.equal(horizontalGuideHoverOpacity(100, 244), 0);
  assert.equal(horizontalGuideHoverOpacity(100, null), 0);
});

test("nearby horizontal guides colour only the nearest snapped line", () => {
  const fills = [];
  const context = {
    globalAlpha: 1,
    lineWidth: 1,
    fillStyle: "",
    strokeStyle: "",
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      throw new Error("horizontal guides must use fillRect");
    },
    fillRect() {
      fills.push({ color: this.fillStyle, alpha: this.globalAlpha });
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

  assert.ok(fills.some(({ color, alpha }) => color === "rgba(128,128,128,1)" && alpha === 1));
  assert.ok(fills.some(({ color }) => color === "#000000"));
});

test("timeline grids keep every visible horizontal guide", () => {
  assert.deepEqual(
    visibleGridTicks(0, 12, 1, null),
    Array.from({ length: 13 }, (_, i) => i),
  );
});

test("disabled vertical grid skips horizontal timeline lines", () => {
  let strokes = 0;
  const context = {
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      strokes += 1;
    },
  };
  const receiver = {
    appearance: { barAlpha: 1, barWidth: 3, subdivisionColors: [] },
    cache: {
      palette: () => ({
        gridMajor: "#000000",
        gridMinor: "#000000",
        gridSubdivisions: [],
        foreground: "foreground",
        playhead: "playhead",
      }),
    },
    gestures: { cursor: null, eventCursor: null, hoverArea: "notes" },
    getSession: () => ({ multiLineMode: "notes" }),
    viewport: {
      snapY: false,
      notesCanvas: { clientWidth: 100 },
      eventsCanvas: { clientWidth: 100 },
      factorForLine: () => 1,
      factor: 1,
      tempo: { seconds: (beat) => beat, beat: (seconds) => seconds },
      origin: 0,
      division: 4,
      judgementOffset: 0,
      scaleForArea: () => 100,
    },
  };

  grid.call(
    receiver,
    context,
    100,
    100,
    0,
    { lines: true, labels: false, playhead: false },
    "notes",
  );

  assert.equal(strokes, 0);
});

test("multi-line beat labels only render in the screen-leftmost visible panel", () => {
  const labels = [];
  const factors = [];
  const context = {
    save() {},
    restore() {},
    fillText(text, x) {
      labels.push({ text, x });
    },
  };
  const receiver = {
    cache: {
      palette: () => ({ foreground: "foreground" }),
    },
    getSession: () => ({ targetLineIndices: [2, 4, 6] }),
    viewport: {
      panelCount: () => 3,
      panelWidth: () => 80,
      panelStride: () => 100,
      multiLineViewportOffset: () => 90,
      visiblePanelRange: () => [1, 2],
      factorForLine: (lineIndex) => {
        factors.push(lineIndex);
        return 1;
      },
      tempo: {
        seconds: (beat) => beat,
        beat: (seconds) => seconds,
      },
      origin: 0,
      division: 4,
      judgementOffset: 0,
      scaleForArea: () => 100,
      verticalForLine: (beat, _lineIndex, height) => height - beat * 20,
    },
  };

  drawMultiLineBeatLabels.call(receiver, context, 200, 200, "notes");

  assert.ok(labels.length > 0);
  assert.deepEqual(new Set(labels.map(({ x }) => x)), new Set([15]));
  assert.deepEqual(factors, [4]);
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
    fillRect(_x, y) {
      positions.push(y);
    },
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
      [2, 25],
      [102, 25],
      [202, 25],
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
  const fills = [];
  const context = {
    globalAlpha: 1,
    fillStyle: "",
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      throw new Error("horizontal guides must use fillRect");
    },
    fillRect() {
      fills.push({ color: this.fillStyle, alpha: this.globalAlpha });
    },
    fillText() {},
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

  assert.ok(fills.some(({ color }) => color === "rgba(128,128,128,1)"));
  assert.ok(!fills.some(({ color }) => color === "#FFFFFF80"));
});

test("a multi-line event grid keeps the hovered line inside its panel", () => {
  const rectangles = [];
  const context = {
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    fillStyle: "",
    fillRect(x, y, width, height) {
      rectangles.push([x, y, width, height]);
    },
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

  gridForLine.call(
    receiver,
    context,
    50,
    30,
    100,
    0,
    1,
    false,
    { lines: true, labels: false, playhead: false },
    "events",
  );

  assert.ok(rectangles.length > 0);
  assert.ok(rectangles.every(([x, _y, width]) => x === 52 && x + width === 78));
});

test("a clipped multi-line panel keeps horizontal guides inside the canvas edges", () => {
  const rectangles = [];
  const batch = {
    isActive: () => true,
    addRect(...args) {
      rectangles.push(args);
    },
  };
  const receiver = {
    appearance: { barAlpha: 1, barWidth: 3, subdivisionColors: [] },
    cache: {
      palette: () => ({
        gridMajor: "#000000",
        gridMinor: "#000000",
        gridSubdivisions: [],
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
      tempo: { seconds: (beat) => beat, beat: (seconds) => seconds },
      origin: 0,
      division: 4,
      judgementOffset: 0,
      scaleForArea: () => 100,
      verticalForLine: () => 50,
    },
    notesGridBatch: batch,
    eventsGridBatch: batch,
    notesPlayheadBatch: { isActive: () => false },
    eventsPlayheadBatch: { isActive: () => false },
  };

  gridForLine.call(
    receiver,
    {
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
    },
    -10,
    30,
    100,
    0,
    0,
    false,
    { lines: true, labels: false, playhead: false },
    "notes",
  );

  assert.ok(rectangles.length > 0);
  assert.ok(rectangles.every(([x, _y, width]) => x >= 2 && x + width <= 98));
});

/**
 * A note-grid receiver whose label layer is never cached, forcing the live pass.
 *
 * `measureText` uses a fixed 10px advance so label tests can reason about the
 * header's natural width independently of the host font stack.
 */
function panelLabelReceiver(
  notesMode,
  {
    panelWidth = 100,
    judgeLineList = [{ Name: "First" }, { Name: "Lead" }, {}, { Name: "" }],
  } = {},
) {
  const labels = [];
  const bands = [];
  let strokes = 0;
  const context = {
    globalAlpha: 1,
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
    textBaseline: "alphabetic",
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      strokes += 1;
    },
    fillRect(x, y, width, height) {
      bands.push({ x, y, width, height, color: this.fillStyle });
    },
    measureText(text) {
      return { width: text.length * 10 };
    },
    fillText(text, x, _y, maxWidth) {
      labels.push({ text, x, maxWidth, align: this.textAlign });
    },
  };
  const receiver = {
    appearance: { verticalGridColor: "#404040", verticalGridCenterColor: "#909020" },
    cache: {
      palette: () => ({
        bottomValue: "#3366FF",
        foreground: "#FFFFFF",
        headerSurface: "#202020",
        outline: "#555555",
      }),
      canvasLayer: () => undefined,
    },
    getSession: () => ({
      notesMode,
      targetLineIndices: [1, 3],
      chart: { judgeLineList },
    }),
    viewport: {
      panelCount: () => 2,
      panelWidth: () => panelWidth,
      panelStride: () => 120,
      multiLineViewportOffset: () => 0,
      visiblePanelRange: () => [0, 1],
    },
  };
  return {
    receiver,
    context,
    labels,
    bands,
    get strokes() {
      return strokes;
    },
  };
}

test("multi-line note panels caption the judge line by number and name", () => {
  const { receiver, context, labels, bands, strokes } = panelLabelReceiver("multi");

  drawMultiLinePanelLabels.call(receiver, context, 240, 300, "notes");

  assert.deepEqual(
    bands,
    [
      { x: 3, y: 0, width: 96, height: 23, color: "#202020" },
      { x: 121, y: 0, width: 98, height: 23, color: "#202020" },
    ],
    "each panel paints the same 23px header band as the event field",
  );
  assert.deepEqual(
    labels.map(({ text }) => text),
    [
      t("editorPanels.timeline.lineHeader", { index: 1, name: "Lead" }),
      t("editorPanels.timeline.lineHeaderIndex", { index: 3 }),
    ],
    "named panels show the name; an untitled panel keeps only its number",
  );
  assert.deepEqual(
    labels.map(({ x }) => x),
    [50, 170],
    "the caption is centered over its panel",
  );
  assert.ok(
    labels.every(({ maxWidth }) => maxWidth === undefined),
    "the caption is never horizontally compressed",
  );
  assert.ok(
    labels.every(({ align }) => align === "center"),
    "the caption uses centered text alignment",
  );
  assert.equal(strokes, 0, "the name band does not paint panel side borders");
});

test("multi-line note panels truncate a name that does not fit the panel", () => {
  const { receiver, context, labels } = panelLabelReceiver("multi", {
    judgeLineList: [
      { Name: "First" },
      { Name: "An extremely long judge line title" },
      {},
      { Name: "" },
    ],
  });

  drawMultiLinePanelLabels.call(receiver, context, 240, 300, "notes");

  assert.deepEqual(
    labels.map(({ text }) => text),
    [
      t("editorPanels.timeline.lineHeader", { index: 1, name: "A..." }),
      t("editorPanels.timeline.lineHeaderIndex", { index: 3 }),
    ],
    "an overlong name is truncated instead of compressed or hidden",
  );
});

test("merged multi-line notes do not caption a single judge line", () => {
  const { receiver, context, labels } = panelLabelReceiver("multi_merged");

  drawMultiLinePanelLabels.call(receiver, context, 240, 300, "notes");

  assert.deepEqual(labels, [], "a merged note field has no single line to name");
});
