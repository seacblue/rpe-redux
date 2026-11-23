/** Verifies marquee work follows the workspace animation frame. */
import assert from "node:assert/strict";
import test from "node:test";
import { EditorRenderScheduler } from "../../../frontend/screens/editor/workspace/runtime/frame/renderScheduler.ts";
import { previewSelectionForFrame } from "../../../frontend/screens/editor/workspace/preview/interaction/previewSelectionMap.ts";

/** A paused preview must observe in-place selection mutations as a new frame input. */
test("paused preview repaints after a selection notification", () => {
  const session = {
    selectionProjectionRevision: 0,
    lineIndex: 0,
    selection: new Set([0]),
    multiLineActive: false,
    multiLineMode: "notes",
    multiLineSelection: new Map(),
  };
  const scheduler = new EditorRenderScheduler();
  const chart = {};
  const firstSelection = previewSelectionForFrame(session);
  const request = {
    now: 0,
    seconds: 0,
    playing: false,
    previewVisible: true,
    contentRefreshRate: 144,
    timelineRevision: 1,
    viewportOrigin: 0,
    previewChart: chart,
    previewRevision: 0,
    previewSession: null,
    previewSelection: firstSelection,
    authoringRegionVisible: true,
  };
  scheduler.tick(request, { paint() {} });

  session.selection.clear();
  session.selection.add(1);
  session.selectionProjectionRevision += 1;
  const nextSelection = previewSelectionForFrame(session);
  const result = scheduler.tick(
    { ...request, now: 1, previewSelection: nextSelection },
    { paint() {} },
  );

  assert.notStrictEqual(nextSelection, firstSelection);
  assert.equal(result.work.preview, true);
});

test("active preview marquee bypasses the preview content rate limit", () => {
  const scheduler = new EditorRenderScheduler();
  const request = {
    now: 0,
    seconds: 0,
    playing: true,
    previewVisible: true,
    previewHighDensity: false,
    contentRefreshRate: 30,
    previewMarqueeActive: true,
    timelineRevision: 1,
    viewportOrigin: 0,
    previewChart: {},
    previewRevision: 0,
    previewSession: null,
    previewSelection: null,
    authoringRegionVisible: true,
  };
  const adapter = { paint() {} };
  scheduler.tick(request, adapter);
  for (let frame = 1; frame < 5; frame++) {
    const result = scheduler.tick({ ...request, now: frame * 7, seconds: frame * 0.007 }, adapter);
    assert.equal(result.work.preview, true);
  }
});

test("active timeline sweep bypasses the preview content rate limit", () => {
  const scheduler = new EditorRenderScheduler();
  const chart = {};
  const firstRequest = {
    now: 0,
    seconds: 0,
    playing: true,
    previewVisible: true,
    contentRefreshRate: 30,
    previewSelectionActive: true,
    timelineRevision: 1,
    viewportOrigin: 0,
    previewChart: chart,
    previewRevision: 0,
    previewSession: null,
    previewSelection: new Map([[0, new Set([0])]]),
    authoringRegionVisible: true,
  };
  const adapter = { paint() {} };
  scheduler.tick(firstRequest, adapter);

  const result = scheduler.tick(
    {
      ...firstRequest,
      now: 1,
      seconds: 0.001,
      previewSelection: new Map([[0, new Set([0, 1])]]),
    },
    adapter,
  );

  assert.equal(result.work.preview, true);
});

test("a selection change still repaints after the sweep has ended", () => {
  const scheduler = new EditorRenderScheduler();
  const chart = {};
  const firstSelection = new Map([[0, new Set([0])]]);
  const request = {
    now: 0,
    seconds: 0,
    playing: true,
    previewVisible: true,
    contentRefreshRate: 30,
    previewSelectionActive: false,
    timelineRevision: 1,
    viewportOrigin: 0,
    previewChart: chart,
    previewRevision: 0,
    previewSession: null,
    previewSelection: firstSelection,
    authoringRegionVisible: true,
  };
  const adapter = { paint() {} };
  scheduler.tick(request, adapter);

  const result = scheduler.tick(
    {
      ...request,
      now: 1,
      seconds: 0.001,
      previewSelectionActive: false,
      previewSelection: new Map([[0, new Set([0, 1])]]),
    },
    adapter,
  );

  assert.equal(result.work.preview, true);
});

test("selection overlay invalidation does not repaint timeline content", () => {
  const scheduler = new EditorRenderScheduler();
  const request = {
    now: 0,
    seconds: 0,
    playing: false,
    previewVisible: false,
    contentRefreshRate: 144,
    timelineRevision: 1,
    viewportOrigin: 0,
    selectionOverlayRevision: 1,
    selectionOverlayActive: true,
    previewChart: {},
    previewRevision: 0,
    previewSession: null,
    previewSelection: null,
    authoringRegionVisible: true,
  };
  const adapter = { paint() {} };

  const first = scheduler.tick(request, adapter);
  assert.equal(first.work.timeline, true);
  assert.equal(first.work.selectionOverlay, true);

  const moved = scheduler.tick({ ...request, now: 1, selectionOverlayRevision: 2 }, adapter);
  assert.equal(moved.work.timeline, false);
  assert.equal(moved.work.selectionOverlay, true);
  assert.equal(moved.work.preview, false);

  const unchanged = scheduler.tick({ ...request, now: 2, selectionOverlayRevision: 2 }, adapter);
  assert.equal(unchanged.work.timeline, false);
  assert.equal(unchanged.work.selectionOverlay, false);

  const finished = scheduler.tick(
    { ...request, now: 3, selectionOverlayRevision: 2, selectionOverlayActive: false },
    adapter,
  );
  assert.equal(finished.work.timeline, false);
  assert.equal(finished.work.selectionOverlay, true);
});
