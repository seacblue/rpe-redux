/**
 * Multi-line event chrome must batch its column labels on every WebGL overlay
 * frame, because the overlay clears its label batch and texture on `begin`.
 * The Canvas2D fallback keeps the cached header strip and repaints it only when
 * its key or size changes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { drawEvents } from "../../../frontend/screens/editor/workspace/timeline/events/eventDrawing.ts";

const palette = {
  headerSurface: "#202020",
  foreground: "#FFFFFF",
  outline: "#555555",
  gridMinor: "#333333",
};

/** A Canvas2D stand-in that records the calls the chrome painter makes. */
function fakeContext() {
  const calls = { fillText: [], fillRect: [], drawImage: [], strokes: 0 };
  return {
    calls,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "left",
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      calls.strokes += 1;
    },
    fillRect(x, y, width, height) {
      calls.fillRect.push({ x, y, width, height });
    },
    fillText(text, x, y) {
      calls.fillText.push({ text, x, y });
    },
    drawImage(...args) {
      calls.drawImage.push(args);
    },
  };
}

/** The minimum canvas surface that `prepareCanvas` measures and clears. */
function fakeCanvas(width, height, context) {
  return {
    width: 0,
    height: 0,
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
    }),
    getContext: () => context,
  };
}

/** A session shaped for the multi-line event field. */
function fakeSession() {
  return {
    eventsMode: "multi",
    targetLineIndices: [0],
    chart: { judgeLineList: [] },
    lineIndex: 0,
    eventSelection: new Set(),
    multiEventSelection: new Map(),
  };
}

/**
 * Build a receiver for one renderer mode.
 *
 * The overlay batch records queued labels and drops them in `begin`, matching
 * the GPU overlay's per-frame clear. The cache layer records invocations and
 * reports a repaint only on the first request.
 */
function fakeReceiver({ overlayActive }) {
  const live = fakeContext();
  const backdrop = fakeContext();
  const layerContext = fakeContext();
  const layerCanvas = { kind: "cached-header-strip" };
  const session = fakeSession();
  const batchTexts = [];
  const batchRects = [];
  const cacheLayerCalls = [];
  let layerFrames = 0;
  const eventOverlayBatch = {
    begin() {
      batchTexts.length = 0;
      batchRects.length = 0;
      return overlayActive;
    },
    finish() {},
    isActive() {
      return overlayActive;
    },
    addRect(x, y, width, height, color) {
      batchRects.push({ x, y, width, height, color });
    },
    addText(text, x, y, maxWidth, font, color, align) {
      batchTexts.push({ text, x, y, maxWidth, font, color, align });
    },
  };
  const receiver = {
    eventsCanvas: fakeCanvas(200, 100, live),
    eventsBackdrop: fakeCanvas(200, 100, backdrop),
    appearance: {
      skin: null,
      eventOpacity: 1,
      verticalGridColor: "#404040",
      multiLineNonCurrentOpacity: 1,
      eventBarWidth: 0.82,
    },
    cache: {
      palette: () => palette,
      tempoSeconds: (_tempo, beat) => beat,
      canvasLayer: (_canvas, key, width, height) => {
        cacheLayerCalls.push({ key, width, height });
        layerFrames += 1;
        return { canvas: layerCanvas, context: layerContext, repaint: layerFrames === 1 };
      },
    },
    gestures: {
      beginEventRectFrame() {},
      finishEventRectFrame() {},
      overlapMenuOpen: false,
      extended: false,
      eventInteraction: { draw() {} },
    },
    viewport: {
      syncMultiLineChrome() {},
      factor: 1,
      scale: 1,
      scaleForArea: () => 1,
      tempo: { seconds: (beat) => beat, beat: (seconds) => seconds },
      origin: 0,
      judgementOffset: 0,
      panelCount: () => 1,
      panelWidth: () => 200,
      panelGap: () => 0,
      panelStride: () => 200,
      eventInset: () => 2,
      multiLineViewportOffset: () => 0,
      visiblePanelRange: () => [0, 0],
      eventTypesForLine: () => ["moveXEvents"],
    },
    getSession: () => session,
    eventOverlayBatch,
    drawMultiLineGrid() {},
    drawMultiLineEvents() {},
    drawMultiLineBeatLabels() {},
    drawMultiLinePanelLabels() {},
    eventBatch: { begin: () => true, finish() {}, add: () => true },
    eventsGridBatch: { begin() {}, finish() {} },
  };
  return {
    receiver,
    live,
    layerContext,
    layerCanvas,
    batchTexts,
    batchRects,
    cacheLayerCalls,
  };
}

test("an overlay frame hit still queues every multi-line event channel label", () => {
  const fixture = fakeReceiver({ overlayActive: true });

  drawEvents.call(fixture.receiver, 0);
  assert.deepEqual(
    fixture.batchTexts.map((entry) => entry.text),
    ["X"],
    "the first overlay frame queues the channel header",
  );
  assert.deepEqual(fixture.batchRects, [
    { x: 2, y: 0, width: 196, height: 23, color: palette.headerSurface },
  ]);
  const fillsAfterFirstFrame = fixture.live.calls.fillRect.length;

  // The overlay clears its label batch on begin, so a cache-hit frame has to
  // queue the label again instead of replaying a stale cached strip.
  drawEvents.call(fixture.receiver, 0);
  assert.deepEqual(
    fixture.batchTexts.map((entry) => entry.text),
    ["X"],
    "the second overlay frame still queues the channel header",
  );
  assert.ok(fillsAfterFirstFrame > 0, "the header fill reaches the live context");
  assert.equal(
    fixture.live.calls.fillRect.length,
    fillsAfterFirstFrame * 2,
    "the header fill is painted on every overlay frame",
  );
  assert.deepEqual(
    fixture.cacheLayerCalls,
    [],
    "the overlay path bypasses the cached header strip",
  );
  assert.equal(
    fixture.live.calls.fillText.length,
    0,
    "a batched label is not also painted on the Canvas2D context",
  );
  assert.equal(
    fixture.batchRects.length,
    1,
    "the overlay header fill is queued again after the curves on every frame",
  );
});

test("the Canvas2D path keeps compositing the cached header strip", () => {
  const fixture = fakeReceiver({ overlayActive: false });

  drawEvents.call(fixture.receiver, 0);
  drawEvents.call(fixture.receiver, 0);

  assert.equal(fixture.cacheLayerCalls.length, 2, "the strip is consulted on both frames");
  assert.equal(
    fixture.layerContext.calls.fillText.length,
    1,
    "the label is painted into the strip only when it repaints",
  );
  assert.equal(
    fixture.live.calls.drawImage.length,
    2,
    "the cached strip is composited onto the live canvas on every frame",
  );
  assert.equal(fixture.batchTexts.length, 0, "the Canvas2D fallback does not batch text");
});
