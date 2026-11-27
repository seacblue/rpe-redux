/**
 * The multi-line horizontal position is user view state: leaving multi-line
 * editing, switching the visible field, or shrinking the line selection must not
 * send the panels back to the left edge, and the clamp must follow the current
 * panel count without rewriting the stored offset.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createValue } from "../../../core/state/values.ts";
import {
  multiLineViewportOffset,
  panMultiLine,
} from "../../../frontend/screens/editor/workspace/timeline/viewport/timelineGeometry.ts";
import { TimelineViewport } from "../../../frontend/screens/editor/workspace/timeline/viewport/timelineViewport.ts";

const WIDTH = 1000;
const PANEL_RATIO = 0.25;

/**
 * A viewport stand-in for the horizontal scroll seam.
 *
 * A panel is a quarter of the width (250 px) and the gap keeps the layout's
 * default 0.04 ratio (10 px), so the stride is 260 px and ten panels span
 * 2590 px: their maximum offset at this width is 1590 px.
 */
function fakeReceiver(scroll, count) {
  const receiver = {
    multiLineScroll: scroll,
    // Panel chrome and the scrollbar read this snapshot, so a pan publishes to it.
    multiLineScrollState: {
      snapshot: createValue({ initial: { visible: true, max: "1590", value: "0" } }),
    },
    panelLayout: () => ({
      active: count > 1,
      count,
      widthRatio: PANEL_RATIO,
      gapRatio: 0.04,
      gapMinimum: 0,
    }),
  };
  receiver.multiLineViewportOffset = (width, area) =>
    multiLineViewportOffset.call(receiver, width, area);
  return receiver;
}

/** Repoint the receiver at another panel count. */
function setPanelCount(receiver, count) {
  receiver.panelLayout = () => ({
    active: count > 1,
    count,
    widthRatio: PANEL_RATIO,
    gapRatio: 0.04,
    gapMinimum: 0,
  });
}

test("a scrolled position survives a shrink to single-line presentation", () => {
  const receiver = fakeReceiver({ notes: 500, events: 0 }, 1);

  assert.equal(multiLineViewportOffset.call(receiver, WIDTH, "notes"), 0);
  assert.deepEqual(
    receiver.multiLineScroll,
    { notes: 500, events: 0 },
    "single-line presentation clamps the painted offset without forgetting the position",
  );
});

test("re-entering multi-line editing resumes the stored position", () => {
  const receiver = fakeReceiver({ notes: 500, events: 0 }, 1);
  multiLineViewportOffset.call(receiver, WIDTH, "notes");

  setPanelCount(receiver, 10);

  assert.equal(multiLineViewportOffset.call(receiver, WIDTH, "notes"), 500);
});

test("the clamp follows the panel count instead of rewriting the offset", () => {
  const receiver = fakeReceiver({ notes: 500, events: 0 }, 10);

  // Ten panels span 2590 px, so the stored 500 is inside the range.
  assert.equal(multiLineViewportOffset.call(receiver, WIDTH, "notes"), 500);
  assert.equal(receiver.multiLineScroll.notes, 500);

  // Three panels span 770 px: nothing scrolls, and the position is retained so
  // growing the selection again returns to the same panel.
  setPanelCount(receiver, 3);
  assert.equal(multiLineViewportOffset.call(receiver, WIDTH, "notes"), 0);
  assert.equal(receiver.multiLineScroll.notes, 500);

  setPanelCount(receiver, 10);
  assert.equal(multiLineViewportOffset.call(receiver, WIDTH, "notes"), 500);
});

test("an offset past the content width is clamped to the last panel", () => {
  const receiver = fakeReceiver({ notes: 5000, events: 0 }, 10);

  assert.equal(multiLineViewportOffset.call(receiver, WIDTH, "notes"), 1590);
  assert.equal(receiver.multiLineScroll.notes, 5000);
});

test("panning writes the panned position for its own area only", () => {
  const receiver = fakeReceiver({ notes: 500, events: 120 }, 10);

  assert.equal(panMultiLine.call(receiver, WIDTH, -100, "notes"), 600);
  assert.deepEqual(receiver.multiLineScroll, { notes: 600, events: 120 });
  assert.equal(
    receiver.multiLineScrollState.snapshot.get().value,
    "600",
    "a pointer pan publishes its offset before the next paint",
  );
});

/** A real viewport over fake canvases, plus the scrollbar cell it publishes to. */
function fakeViewport(initial = { visible: true, max: "1500", value: "500" }) {
  const snapshot = createValue({ initial });
  const tempo = { seconds: (beat) => beat, beat: (seconds) => seconds };
  const viewport = new TimelineViewport(
    {},
    {},
    () => ({}),
    () => tempo,
    () => [],
    {},
    { snapshot },
  );
  return { viewport, snapshot };
}

test("a mode reset keeps the per-area position and clears the frame projection", () => {
  const { viewport, snapshot } = fakeViewport();
  viewport.multiLineScroll = { notes: 500, events: 120 };
  viewport.originalPanelWidth = 320;

  viewport.resetModeState();

  assert.deepEqual(viewport.multiLineScroll, { notes: 500, events: 120 });
  assert.equal(viewport.originalPanelWidth, 0, "panel geometry still resets for the new mode");
  assert.deepEqual(
    snapshot.get(),
    { visible: false, max: "0", value: "0" },
    "the scrollbar keeps only its placeholder until the next paint republishes it",
  );
});

test("a newly installed document starts the multi-line position at the left", () => {
  const { viewport, snapshot } = fakeViewport();
  viewport.multiLineScroll = { notes: 500, events: 120 };

  viewport.resetMultiLineScroll();

  assert.deepEqual(viewport.multiLineScroll, { notes: 0, events: 0 });
  assert.deepEqual(snapshot.get(), { visible: false, max: "0", value: "0" });
});
