/** Verifies timeline zoom bounds do not schedule redundant repaint work. */
import assert from "node:assert/strict";
import test from "node:test";
import { verticalAtBeat } from "../../../core/edit/timeline/timelineCoordinates.ts";
import {
  clampTimelineScale,
  minimumTimelineBeatAtTop,
  TIMELINE_SCALE_MAX,
  TIMELINE_SCALE_MIN,
} from "../../../frontend/screens/editor/workspace/timeline/viewport/timelineViewport.ts";
import { TimelineZoomAnimator } from "../../../frontend/screens/editor/workspace/timeline/interaction/timelineZoom.ts";

test("timeline scale is bounded to the supported 25% through 400% range", () => {
  assert.equal(TIMELINE_SCALE_MIN, 125);
  assert.equal(TIMELINE_SCALE_MAX, 2000);
  assert.equal(clampTimelineScale(20), TIMELINE_SCALE_MIN);
  assert.equal(clampTimelineScale(500), 500);
  assert.equal(clampTimelineScale(2500), TIMELINE_SCALE_MAX);
});

test("beat zero stays at the top tolerance across supported scales", () => {
  const tempo = {
    seconds: (beat) => beat,
    beat: (seconds) => seconds,
  };
  for (const scale of [TIMELINE_SCALE_MIN, 500, TIMELINE_SCALE_MAX]) {
    const origin = minimumTimelineBeatAtTop(tempo, 720, scale, 56);
    assert.ok(
      Math.abs(verticalAtBeat(0, 720, { origin, factor: 1, scale, judgementOffset: 56 }, tempo)) <
        1e-9,
    );
  }
});

test("a zoom-out request at the minimum scale is consumed without a repaint", () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const frames = new Map();
  let nextFrame = 1;
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  try {
    const viewport = {
      scale: TIMELINE_SCALE_MIN,
      origin: 0,
      judgementOffset: 56,
      factor: 1,
      viewHeight: () => 720,
      minimumScrollSeconds: () => 0,
      setOrigin(value) {
        this.origin = value;
        return true;
      },
      tempo: {
        seconds: (beat) => beat,
        beat: (seconds) => seconds,
      },
    };
    let invalidations = 0;
    const animator = new TimelineZoomAnimator(
      viewport,
      () => {
        invalidations += 1;
      },
      () => {},
    );

    assert.equal(animator.request(0.5), false);
    assert.equal(animator.active, false);
    assert.equal(frames.size, 0);
    assert.equal(invalidations, 0);
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});

test("zoom keeps the current playhead beat on the bottom red line", () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const frames = new Map();
  let nextFrame = 1;
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  try {
    const viewport = {
      scale: 500,
      origin: 10,
      judgementOffset: 56,
      factor: 1,
      viewHeight: () => 720,
      minimumScrollSeconds: () => -100,
      setOrigin(value) {
        this.origin = value;
        return true;
      },
      tempo: {
        seconds: (beat) => beat,
        beat: (seconds) => seconds,
      },
    };
    const animator = new TimelineZoomAnimator(
      viewport,
      () => {},
      () => {},
    );

    assert.equal(animator.request(0.8), true);
    frames.get(1)(performance.now() + 200);

    assert.equal(viewport.scale, 400);
    assert.equal(viewport.origin, 10);
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});

test("zooming in from a negative playhead does not clamp the red line away", () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const frames = new Map();
  let nextFrame = 1;
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  try {
    const viewport = {
      scale: 125,
      origin: -10,
      judgementOffset: 56,
      factor: 1,
      viewHeight: () => 720,
      minimumScrollSeconds: () => -5,
      setOrigin(value) {
        this.origin = value;
        return true;
      },
      tempo: {
        seconds: (beat) => beat,
        beat: (seconds) => seconds,
      },
    };
    const animator = new TimelineZoomAnimator(
      viewport,
      () => {},
      () => {},
    );

    assert.equal(animator.request(4), true);
    frames.get(1)(performance.now() + 200);

    assert.equal(viewport.scale, 500);
    assert.equal(viewport.origin, -10);
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});

test("playback keeps ownership of the viewport origin during zoom", () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const frames = new Map();
  let nextFrame = 1;
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  try {
    const viewport = {
      scale: 500,
      origin: -10,
      judgementOffset: 56,
      factor: 1,
      viewHeight: () => 720,
      minimumScrollSeconds: () => 0,
      setOrigin(value) {
        this.origin = value;
        return true;
      },
      tempo: {
        seconds: (beat) => beat,
        beat: (seconds) => seconds,
      },
    };
    let invalidations = 0;
    const animator = new TimelineZoomAnimator(
      viewport,
      () => {
        invalidations += 1;
      },
      () => {},
      () => true,
    );

    assert.equal(animator.request(0.8), true);
    viewport.origin = -8;
    frames.get(1)(performance.now() + 200);

    assert.equal(viewport.origin, -8);
    assert.equal(viewport.scale, 400);
    assert.equal(invalidations, 1);
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});

test("playback ownership rejects late origin writes but releases them after pause", async () => {
  const { TimelineViewport } =
    await import("../../../frontend/screens/editor/workspace/timeline/viewport/timelineViewport.ts");
  const tempo = {
    seconds: (beat) => beat,
    beat: (seconds) => seconds,
  };
  const viewport = new TimelineViewport(
    {},
    {},
    () => ({}),
    () => tempo,
    () => [],
    {},
    {},
  );

  viewport.setPlaybackActive(true);
  assert.equal(viewport.setOrigin(12, "zoom"), false);
  assert.equal(viewport.setOrigin(12, "session"), false);
  assert.equal(viewport.origin, 0);
  assert.equal(viewport.setOrigin(12, "playback"), true);
  assert.equal(viewport.origin, 12);

  viewport.setPlaybackActive(false);
  assert.equal(viewport.setOrigin(-8, "seek"), true);
  assert.equal(viewport.origin, -8);
});
