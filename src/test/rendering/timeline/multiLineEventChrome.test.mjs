/**
 * Multi-line event chrome captions each panel with its judge line instead of
 * repeating the event-type column names. The overlay path must queue the band
 * fill and the caption on every WebGL frame, because the overlay clears its
 * label batch and texture on `begin`; the Canvas2D path keeps the cached strip
 * and repaints it only when its key or size changes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { drawEvents } from "../../../frontend/screens/editor/workspace/timeline/events/eventDrawing.ts";
import { t } from "../../../i18n/index.ts";

const palette = {
  headerSurface: "#202020",
  foreground: "#FFFFFF",
  bottomValue: "#3366FF",
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
    fillText(text, x, y, maxWidth) {
      calls.fillText.push({ text, x, y, maxWidth });
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

/** The judge-line caption the chrome should paint for the fake panel. */
const headerText = t("editorPanels.timeline.lineHeader", { index: 0, name: "Lead" });

/** A session shaped for the multi-line event field. */
function fakeSession() {
  return {
    eventsMode: "multi",
    targetLineIndices: [0],
    chart: { judgeLineList: [{ Name: "Lead" }] },
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
    remoteSelectedEventIds: new Set(),
    eventOverlayBatch,
    drawMultiLineGrid() {},
    drawMultiLineEvents() {},
    drawMultiLineBeatLabels() {},
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

test("an overlay frame queues the judge-line caption above the band fill", () => {
  const fixture = fakeReceiver({ overlayActive: true });

  drawEvents.call(fixture.receiver, 0);
  assert.deepEqual(
    fixture.batchTexts.map((entry) => entry.text),
    [headerText],
    "the panel header names the judge line instead of the event track",
  );
  assert.equal(fixture.batchTexts[0].align, "center");
  assert.equal(fixture.batchTexts[0].x, 100, "the caption is centered over its panel");
  assert.equal(fixture.batchTexts[0].maxWidth, 184);
  assert.deepEqual(fixture.batchRects, [
    { x: 2, y: 0, width: 196, height: 23, color: palette.headerSurface },
  ]);
  const fillsAfterFirstFrame = fixture.live.calls.fillRect.length;

  // The overlay clears its label batch on begin, so a cache-hit frame has to
  // queue the caption again instead of replaying a stale cached strip.
  drawEvents.call(fixture.receiver, 0);
  assert.deepEqual(
    fixture.batchTexts.map((entry) => entry.text),
    [headerText],
    "the second overlay frame still queues the judge-line caption",
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
  assert.deepEqual(
    fixture.layerContext.calls.fillText.map((entry) => entry.text),
    [headerText],
    "the caption is painted into the strip only when it repaints",
  );
  assert.equal(
    fixture.live.calls.drawImage.length,
    2,
    "the cached strip is composited onto the live canvas on every frame",
  );
  assert.equal(fixture.batchTexts.length, 0, "the Canvas2D fallback does not batch text");
});
