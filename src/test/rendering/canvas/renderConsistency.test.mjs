/** Verifies render-cache, paint-order, opacity, and WebGL context-recovery contracts. */
import assert from "node:assert/strict";
import test from "node:test";
import { measureCanvas } from "../../../frontend/screens/editor/canvas/canvas2d.ts";
import { NoteBatch } from "../../../frontend/screens/editor/canvas/noteBatch.ts";
import { notePaintLayer } from "../../../frontend/screens/editor/canvas/noteSpriteGroups.ts";
import { TimelineLineBatch } from "../../../frontend/screens/editor/canvas/timelineLineBatch.ts";
import { TimelineSolidBatch } from "../../../frontend/screens/editor/canvas/timelineSolidBatch.ts";
import {
  noteSkewAtHit,
  noteSkewCurve,
  noteSkewShear,
} from "../../../frontend/screens/editor/canvas/noteGeometry.ts";
import {
  drawLinePasses,
  holdFallbackAlpha,
  isPreviewNoteSelected,
  linePasses,
  previewNoteTint,
  shouldHighlightPreviewNote,
} from "../../../frontend/screens/editor/workspace/preview/drawing/previewLines.ts";
import { passesForSampling } from "../../../frontend/screens/editor/workspace/preview/drawing/previewPassOrder.ts";
import {
  drawEventBar,
  eventBarOpacity,
} from "../../../frontend/screens/editor/workspace/timeline/events/eventRenderCache.ts";
import { TimelineEventBatch } from "../../../frontend/screens/editor/workspace/timeline/events/timelineEventBatch.ts";
import { EditorRenderScheduler } from "../../../frontend/screens/editor/workspace/runtime/frame/renderScheduler.ts";

/** A canvas and WebGL2 stub that tracks listeners, draw calls, and drawn textures. */
function fakeWebGLCanvas() {
  const listeners = new Map();
  let lost = false;
  const calls = { draws: 0, uploads: [], bufferAllocations: [], drawSources: [] };
  const textureSources = new Map();
  let pendingTexture = null;
  let boundTexture = null;
  const noop = () => {};
  const gl = new Proxy(
    {
      VERTEX_SHADER: 1,
      FRAGMENT_SHADER: 2,
      COMPILE_STATUS: 3,
      LINK_STATUS: 4,
      ARRAY_BUFFER: 5,
      STATIC_DRAW: 6,
      STREAM_DRAW: 7,
      TEXTURE_2D: 8,
      TEXTURE_MIN_FILTER: 9,
      TEXTURE_MAG_FILTER: 10,
      TEXTURE_WRAP_S: 11,
      TEXTURE_WRAP_T: 12,
      LINEAR: 13,
      CLAMP_TO_EDGE: 14,
      BLEND: 15,
      SRC_ALPHA: 16,
      ONE_MINUS_SRC_ALPHA: 17,
      COLOR_BUFFER_BIT: 18,
      SCISSOR_TEST: 19,
      TRIANGLE_STRIP: 20,
      FLOAT: 21,
      TEXTURE0: 22,
      isContextLost: () => lost,
      getShaderParameter: () => true,
      getProgramParameter: () => true,
      getShaderInfoLog: () => "",
      getUniformLocation: () => null,
      getAttribLocation: () => 0,
      createShader: () => ({}),
      createProgram: () => ({}),
      createBuffer: () => ({}),
      createTexture: () => {
        pendingTexture = {};
        return pendingTexture;
      },
      texImage2D: (_target, _level, _internal, _format, _type, source) => {
        if (pendingTexture) {
          textureSources.set(pendingTexture, source);
        }
      },
      bindTexture: (_target, texture) => {
        boundTexture = texture;
      },
      drawArraysInstanced: () => {
        calls.draws += 1;
        calls.drawSources.push(textureSources.get(boundTexture) ?? null);
      },
      bufferSubData: (_target, _offset, data) => {
        calls.uploads.push(Array.from(data));
      },
      bufferData: (_target, size) => {
        if (typeof size === "number") {
          calls.bufferAllocations.push(size);
        }
      },
    },
    {
      get(target, property) {
        if (property in target) {
          return target[property];
        }
        return noop;
      },
    },
  );
  const canvas = {
    width: 0,
    height: 0,
    clientWidth: 100,
    clientHeight: 100,
    getContext: (type) => (type === "webgl2" ? gl : null),
    addEventListener: (type, listener) => {
      const current = listeners.get(type) ?? [];
      current.push(listener);
      listeners.set(type, current);
    },
    removeEventListener: (type, listener) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
      );
    },
    dispatch(type) {
      const event = {
        type,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      if (type === "webglcontextlost") {
        lost = true;
      } else if (type === "webglcontextrestored") {
        lost = false;
      }
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
      return event;
    },
  };
  return { canvas, calls };
}

const textureSource = {
  naturalWidth: 8,
  naturalHeight: 8,
  width: 8,
  height: 8,
};
const descriptor = {
  source: textureSource,
  useful: { x: 0, y: 0, width: 8, height: 8 },
};

/** A texture descriptor whose source carries a label for draw-order assertions. */
function labeledDescriptor(label) {
  return {
    source: { label, naturalWidth: 8, naturalHeight: 8, width: 8, height: 8 },
    useful: { x: 0, y: 0, width: 8, height: 8 },
  };
}

/** The source label of every texture the batch painted, in draw order. */
function paintedSources(calls) {
  return calls.drawSources.map((source) => source?.label ?? null);
}

test("GPU event bars carry the per-line opacity alongside the global alpha", () => {
  const { canvas, calls } = fakeWebGLCanvas();
  const batch = new TimelineEventBatch(canvas);
  const skin = { eventBarTexture: () => descriptor };
  assert.equal(batch.begin(100, 100, skin, eventBarOpacity(0.8)), true);
  assert.equal(batch.add({ x: 1, y: 2, width: 10, height: 20 }, 0.5), true);
  assert.equal(batch.alpha, 0.8);
  assert.equal(batch.instances[8], 0.5);
  batch.finish();
  assert.equal(calls.draws, 1);
});

test("GPU event buffers reuse stable capacity without changing packed uploads", () => {
  const { canvas, calls } = fakeWebGLCanvas();
  const batch = new TimelineEventBatch(canvas);
  const skin = { eventBarTexture: () => descriptor };
  assert.equal(batch.begin(100, 100, skin, 1), true);
  assert.equal(batch.add({ x: 1, y: 2, width: 10, height: 20 }, 0.5), true);
  batch.finish();
  const firstUpload = calls.uploads[0];

  assert.equal(batch.begin(100, 100, skin, 1), true);
  assert.equal(batch.add({ x: 3, y: 4, width: 12, height: 24 }, 0.25), true);
  batch.finish();

  assert.equal(calls.bufferAllocations.length, 1);
  assert.equal(calls.uploads.length, 2);
  assert.notDeepEqual(calls.uploads[1], firstUpload);
  assert.deepEqual(calls.uploads[1].slice(8), [0.25]);
});

test("timeline line and solid buffers reuse stable capacity", () => {
  const cases = [
    [TimelineLineBatch, (batch) => batch.addRect(1, 2, 10, 20, "#ffffff")],
    [TimelineSolidBatch, (batch) => batch.addRect(5, 6, 10, 20, 0, 0, 1, "#ffffff")],
  ];
  for (const [Batch, add] of cases) {
    const { canvas, calls } = fakeWebGLCanvas();
    const batch = new Batch(canvas);
    assert.equal(batch.begin(100, 100), true);
    add(batch);
    batch.finish();
    assert.equal(batch.begin(100, 100), true);
    add(batch);
    batch.finish();
    assert.equal(calls.bufferAllocations.length, 1);
    assert.equal(calls.uploads.length, 2);
  }
});

test("preview note buffers orphan each frame while keeping a stable capacity", () => {
  const { canvas, calls } = fakeWebGLCanvas();
  const batch = new NoteBatch(canvas);
  const skin = {
    noteTexture: () => descriptor,
    holdBodyTexture: () => descriptor,
    holdHeadTexture: () => descriptor,
    holdEndTexture: () => descriptor,
  };

  batch.begin(100, 100, skin);
  assert.equal(batch.addHead(skin, 1, false, 20, 20, 8, 0, 0, 1), true);
  batch.finish();
  const firstUpload = calls.uploads[0];

  batch.begin(100, 100, skin);
  assert.equal(batch.addHead(skin, 1, false, 80, 80, 8, 0, 0, 1), true);
  batch.finish();

  assert.equal(calls.bufferAllocations.length, 2);
  assert.equal(calls.bufferAllocations[0], calls.bufferAllocations[1]);
  assert.equal(calls.uploads.length, 2);
  assert.notDeepEqual(calls.uploads[1], firstUpload);
  assert.equal(calls.uploads[1][0], 80);
  assert.equal(calls.uploads[1][1], 80);
});

test("preview note rotations reuse trigonometry across stable frames", () => {
  const originalCos = Math.cos;
  const originalSin = Math.sin;
  let cosCalls = 0;
  let sinCalls = 0;
  Math.cos = (value) => {
    cosCalls += 1;
    return originalCos(value);
  };
  Math.sin = (value) => {
    sinCalls += 1;
    return originalSin(value);
  };
  try {
    const { canvas } = fakeWebGLCanvas();
    const batch = new NoteBatch(canvas);
    const skin = {
      noteTexture: () => descriptor,
      holdBodyTexture: () => descriptor,
      holdHeadTexture: () => descriptor,
      holdEndTexture: () => descriptor,
    };
    batch.begin(100, 100, skin);
    assert.equal(batch.addHead(skin, 1, false, 20, 20, 8, 0.25, 0, 1), true);
    batch.finish();
    batch.begin(100, 100, skin);
    assert.equal(batch.addHead(skin, 1, false, 80, 80, 8, 0.25, 0, 1), true);
    batch.finish();
    assert.equal(cosCalls, 1);
    assert.equal(sinCalls, 1);
  } finally {
    Math.cos = originalCos;
    Math.sin = originalSin;
  }
});

test("event-bar opacity matches between the canvas fallback and the batch", () => {
  assert.equal(eventBarOpacity(undefined), 1);
  assert.equal(eventBarOpacity(0.8, 0.5), 0.4);
  assert.equal(eventBarOpacity(1, 0.25), 0.25);
  const calls = [];
  const receiver = {
    eventBatch: {
      add(_rectangle, alpha) {
        calls.push(alpha);
        return true;
      },
    },
    appearance: { skin: null },
  };
  drawEventBar(receiver, {}, { x: 0, y: 0, width: 4, height: 8 }, 0.5);
  assert.deepEqual(calls, [0.5]);
});

test("Hold fallback keeps the body and head alpha identical", () => {
  assert.equal(holdFallbackAlpha(1, 0.5), 0.5);
  assert.equal(holdFallbackAlpha(0.4, 0.5), 0.2);
  assert.equal(holdFallbackAlpha(2, 0.5), 0.5);
});

test("note skew shear is one degree-to-shear conversion for both renderers", () => {
  assert.equal(noteSkewShear(0), 0);
  assert.ok(Math.abs(noteSkewShear(45) - 1) < 1e-12);
  assert.ok(Math.abs(noteSkewShear(-45) + 1) < 1e-12);
  assert.equal(noteSkewShear(12.5), Math.tan((12.5 * Math.PI) / 180));
});

test("timeline skew samples the line control where the note meets the line", () => {
  const curve = noteSkewCurve({
    skewControl: [
      { x: 0, skew: 0.5 },
      { x: 100, skew: 1.5 },
    ],
  });
  assert.ok(curve);
  assert.equal(noteSkewAtHit(curve, { type: 1, positionX: 40, yOffset: 0 }), 20);
  assert.equal(noteSkewAtHit(curve, { type: 1, positionX: 40, yOffset: 100 }), 60);
  assert.equal(noteSkewAtHit(curve, { type: 2, positionX: 40, yOffset: 100 }), 0);
  assert.equal(
    noteSkewAtHit(noteSkewCurve({ skewControl: [{ x: 0, skew: 5 }] }), {
      type: 1,
      positionX: 40,
      yOffset: 0,
    }),
    0,
  );
  assert.equal(noteSkewAtHit(null, { type: 1, positionX: 40, yOffset: 0 }), 0);
});

test("canvas measurement is cached until the size or pixel ratio changes", () => {
  const canvas = {
    clientWidth: 320,
    clientHeight: 180,
    rectCalls: 0,
    getBoundingClientRect() {
      this.rectCalls += 1;
      return { width: this.clientWidth + 0.5, height: this.clientHeight + 0.25 };
    },
  };
  const initial = measureCanvas(canvas);
  assert.equal(initial.width, 320.5);
  assert.equal(initial.height, 180.25);
  assert.equal(canvas.rectCalls, 1);
  const cached = measureCanvas(canvas);
  assert.equal(cached.width, 320.5);
  assert.equal(cached.height, 180.25);
  assert.equal(canvas.rectCalls, 1);
  canvas.clientWidth = 640;
  canvas.clientHeight = 360;
  const resized = measureCanvas(canvas);
  assert.equal(resized.width, 640.5);
  assert.equal(resized.height, 360.25);
  assert.equal(canvas.rectCalls, 2);
  const originalRatio = globalThis.devicePixelRatio;
  try {
    globalThis.devicePixelRatio = (originalRatio || 1) + 1;
    const ratioChanged = measureCanvas(canvas);
    assert.equal(ratioChanged.width, 640.5);
    assert.equal(ratioChanged.height, 360.25);
    assert.equal(canvas.rectCalls, 3);
  } finally {
    globalThis.devicePixelRatio = originalRatio;
  }
});

test("event batch degrades to canvas while the context is lost and rebuilds on restore", () => {
  const { canvas, calls } = fakeWebGLCanvas();
  const batch = new TimelineEventBatch(canvas);
  const skin = { eventBarTexture: () => descriptor };
  batch.begin(100, 100, skin, 1);
  assert.equal(batch.isActive(), true);
  const lost = canvas.dispatch("webglcontextlost");
  assert.equal(lost.defaultPrevented, true);
  assert.equal(batch.isContextLost(), true);
  assert.equal(batch.isActive(), false);
  assert.equal(batch.begin(100, 100, skin, 1), true);
  assert.equal(batch.isActive(), false);
  assert.equal(batch.add({ x: 0, y: 0, width: 10, height: 10 }), false);
  batch.finish();
  assert.equal(calls.draws, 0);
  canvas.dispatch("webglcontextrestored");
  assert.equal(batch.isContextLost(), false);
  batch.begin(100, 100, skin, 1);
  assert.equal(batch.isActive(), true);
  assert.equal(batch.add({ x: 0, y: 0, width: 10, height: 10 }), true);
  batch.finish();
  assert.equal(calls.draws, 1);
});

test("note batch degrades to canvas while the context is lost and rebuilds on restore", () => {
  const { canvas, calls } = fakeWebGLCanvas();
  const batch = new NoteBatch(canvas);
  const skin = {
    noteTexture: () => descriptor,
    holdBodyTexture: () => descriptor,
    holdHeadTexture: () => descriptor,
    holdEndTexture: () => descriptor,
  };
  batch.begin(100, 100, skin);
  assert.equal(batch.isActive(), true);
  assert.equal(batch.addHead(skin, 1, false, 50, 50, 8, 0, 0, 1), true);
  const lost = canvas.dispatch("webglcontextlost");
  assert.equal(lost.defaultPrevented, true);
  assert.equal(batch.isContextLost(), true);
  assert.equal(batch.isActive(), false);
  assert.equal(batch.addHead(skin, 1, false, 50, 50, 8, 0, 0, 1), false);
  batch.finish();
  assert.equal(calls.draws, 0);
  canvas.dispatch("webglcontextrestored");
  assert.equal(batch.isContextLost(), false);
  batch.begin(100, 100, skin);
  assert.equal(batch.isActive(), true);
  assert.equal(batch.addHead(skin, 1, false, 50, 50, 8, 0, 0, 1), true);
  batch.finish();
  assert.equal(calls.draws, 1);
});

test("active note batches skip line transforms while fallback notes restore them", () => {
  const previousDocument = globalThis.document;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  const previousWindow = globalThis.window;
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "#FFFFFF" });
  globalThis.window = { addEventListener() {} };
  try {
    const calls = [];
    const context = {
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
      translate: (x, y) => calls.push(["translate", x, y]),
      rotate: (angle) => calls.push(["rotate", angle]),
      fillRect() {},
    };
    const note = { type: 1 };
    const entry = { note, noteIndex: 0 };
    const state = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, alpha: 1 };
    const runtime = {
      line: {},
      noteState(_entry, _state, _seconds, target) {
        Object.assign(target, {
          x: 0,
          y: 0,
          tail: 0,
          size: 1,
          alpha: 1,
          skew: 0,
          showHead: false,
        });
        return target;
      },
    };
    const frame = {
      context,
      chart: { judgeLineList: [{}] },
      states: [state],
      order: [0],
      visibleNotes: [[entry]],
      visibleHolds: [[]],
      seconds: 0,
      selectedLine: -1,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      viewport: { left: 0, top: 0, width: 100, height: 100 },
      centerX: 50,
      centerY: 50,
      scene: { lines: [runtime] },
    };
    const surface = {
      noteBatch: { isActive: () => true, addHead: () => true, addHold: () => true },
      passes: [{ kind: "note", depth: 1000 }],
      noteOpacity: 1,
      selectedLines: [],
      selectedLineColor: [],
      selectedNotes: new Map(),
      simultaneous: null,
      noteSize: 175,
      lineFrames: [],
      noteHitAreas: [],
      collectGeometry: false,
      skin: null,
    };

    const batched = drawLinePasses(surface, frame);
    assert.equal(batched.notes, 1);
    assert.deepEqual(calls, []);

    surface.noteBatch.addHead = () => false;
    const fallback = drawLinePasses(surface, frame);
    assert.equal(fallback.batchFallbacks, 1);
    assert.deepEqual(calls, [
      "save",
      ["translate", 50, 50],
      ["rotate", 0],
      "save",
      "restore",
      "restore",
    ]);

    calls.length = 0;
    const movedFrame = { ...frame, states: [{ ...state, x: 10 }] };
    drawLinePasses(surface, movedFrame);
    assert.deepEqual(calls, [
      "save",
      ["translate", 60, 50],
      ["rotate", 0],
      "save",
      "restore",
      "restore",
    ]);
  } finally {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
    if (previousGetComputedStyle === undefined) {
      delete globalThis.getComputedStyle;
    } else {
      globalThis.getComputedStyle = previousGetComputedStyle;
    }
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test("selected note instances render after ordinary instances", () => {
  const { canvas, calls } = fakeWebGLCanvas();
  const batch = new NoteBatch(canvas);
  const skin = {
    noteTexture: () => descriptor,
    holdBodyTexture: () => descriptor,
    holdHeadTexture: () => descriptor,
    holdEndTexture: () => descriptor,
  };

  batch.begin(100, 100, skin);
  assert.equal(batch.addHead(skin, 1, false, 50, 50, 8, 0, 0, 1), true);
  assert.equal(
    batch.addHead(skin, 1, false, 50, 50, 8, 0, 0, 1, { mode: "selected", color: [0, 200, 0] }),
    true,
  );
  batch.finish();

  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.uploads[0][14], 0);
  assert.equal(calls.uploads[0][15 + 14], 1);
});

test("adaptive note density keeps logical size while lowering only the GPU backing store", () => {
  const previousRatio = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 2;
  try {
    const { canvas } = fakeWebGLCanvas();
    const batch = new NoteBatch(canvas);
    const skin = {
      noteTexture: () => descriptor,
      holdBodyTexture: () => descriptor,
      holdHeadTexture: () => descriptor,
      holdEndTexture: () => descriptor,
    };
    batch.begin(100, 100, skin);
    assert.equal(canvas.width, 200);
    batch.begin(100, 100, skin, undefined, 0.8);
    assert.equal(canvas.width, 160);
    assert.equal(canvas.height, 160);
  } finally {
    globalThis.devicePixelRatio = previousRatio;
  }
});

test("note batch paints Holds beneath note heads even after a head texture was used first", () => {
  const { canvas, calls } = fakeWebGLCanvas();
  const sources = {
    tap: labeledDescriptor("tap"),
    holdBody: labeledDescriptor("hold-body"),
    holdEnd: labeledDescriptor("hold-end"),
    holdHead: labeledDescriptor("hold-head"),
  };
  const skin = {
    noteTexture: () => sources.tap,
    holdBodyTexture: () => sources.holdBody,
    holdEndTexture: () => sources.holdEnd,
    holdHeadTexture: () => sources.holdHead,
  };
  const batch = new NoteBatch(canvas);

  // First frame: only a Tap, so its texture group exists before any Hold part.
  batch.begin(100, 100, skin);
  assert.equal(batch.addHead(skin, 1, false, 50, 50, 8, 0, 0, 1), true);
  batch.finish();
  assert.deepEqual(paintedSources(calls), ["tap"]);

  calls.drawSources.length = 0;
  // A later frame submits the Hold first; the existing head group must not
  // float above it just because it was created in an earlier frame.
  batch.begin(100, 100, skin);
  assert.equal(batch.addHold(skin, false, 50, 50, 50, 20, 8, true, 1), true);
  assert.equal(batch.addHead(skin, 1, false, 50, 50, 8, 0, 0, 1), true);
  batch.finish();
  assert.deepEqual(paintedSources(calls), ["hold-body", "hold-end", "hold-head", "tap"]);
});

test("Holds keep the low paint layer for every Tap, Drag, and Flick head", () => {
  assert.equal(notePaintLayer(2), 0);
  for (const headType of [1, 3, 4]) {
    assert.ok(
      notePaintLayer(2) < notePaintLayer(headType),
      `Hold layer ${notePaintLayer(2)} must be below head type ${headType}`,
    );
  }
  assert.deepEqual(
    [1, 2, 3, 4].sort((left, right) => notePaintLayer(left) - notePaintLayer(right)),
    [2, 1, 3, 4],
  );
});

test("preview draw passes paint Holds before note heads", () => {
  const passes = linePasses([{ zOrder: 5 }, { zOrder: 1 }], [0, 1]);
  assert.deepEqual(
    passes.map((pass) => pass.kind),
    ["line", "line", "hold", "note"],
  );
  const hold = passes.find((pass) => pass.kind === "hold");
  const note = passes.find((pass) => pass.kind === "note");
  assert.ok(hold.depth < note.depth);
});

test("sampled preview line reorder preserves non-line pass order", () => {
  const source = [
    { kind: "line", index: 2, depth: 0 },
    { kind: "hold", depth: 999 },
    { kind: "line", index: 5, depth: 1 },
    { kind: "note", depth: 1000 },
  ];
  const actual = passesForSampling(source, 2);
  assert.deepEqual(
    actual.map((pass) => `${pass.kind}:${pass.index ?? ""}`),
    ["line:5", "line:2", "hold:", "note:"],
  );
  assert.deepEqual(passesForSampling(source, null), source);
  assert.equal(passesForSampling(source, 2), passesForSampling(source, 2));
});

test("authored green tint stays in multiply mode while selected green uses recoloring", () => {
  const { canvas, calls } = fakeWebGLCanvas();
  const batch = new NoteBatch(canvas);
  const skin = {
    noteTexture: () => descriptor,
    holdBodyTexture: () => descriptor,
    holdHeadTexture: () => descriptor,
    holdEndTexture: () => descriptor,
  };
  batch.begin(100, 100, skin);
  batch.addHead(skin, 1, false, 20, 20, 8, 0, 0, 1, { mode: "tint", color: [0, 200, 0] });
  batch.addHead(skin, 1, false, 40, 40, 8, 0, 0, 1, { mode: "selected", color: [0, 200, 0] });
  batch.finish();
  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.uploads[0][14], 0);
  assert.equal(calls.uploads[0][15 + 14], 1);
  assert.equal(calls.uploads[0][12], calls.uploads[0][15 + 12]);
});

test("ordinary preview notes keep their authored tint", () => {
  assert.deepEqual(previewNoteTint({ tint: [12, 34, 56], color: [90, 80, 70] }), [12, 34, 56]);
  assert.deepEqual(previewNoteTint({ color: [90, 80, 70] }), [90, 80, 70]);
  assert.equal(previewNoteTint({}), undefined);
});

test("preview selection resolves note indexes without changing their render kind", () => {
  const selected = new Map([[2, new Set([4])]]);
  assert.equal(isPreviewNoteSelected(selected, 2, 4), true);
  assert.equal(isPreviewNoteSelected(selected, 2, 5), false);
  assert.equal(isPreviewNoteSelected(selected, 1, 4), false);
});

test("preview selection does not enable the simultaneous-note highlight skin", () => {
  const note = { type: 1 };
  const surface = {
    highlight: true,
    simultaneous: new Set(),
  };
  const selectedEntry = { note, noteIndex: 4 };
  assert.equal(shouldHighlightPreviewNote(surface, selectedEntry), false);

  surface.simultaneous.add(note);
  assert.equal(shouldHighlightPreviewNote(surface, selectedEntry), true);
});

test("a paused, unchanged frame does not repaint the playhead", () => {
  const scheduler = new EditorRenderScheduler();
  const request = {
    now: 0,
    seconds: 0,
    playing: false,
    previewVisible: false,
    previewHighDensity: false,
    contentRefreshRate: 144,
    timelineRevision: 1,
    viewportOrigin: 0,
    previewChart: {},
    previewRevision: 0,
    previewSession: null,
    previewSelection: null,
    authoringRegionVisible: true,
  };
  const adapter = { paint() {} };
  const first = scheduler.tick(request, adapter);
  assert.equal(first.work.timeline, true);
  assert.equal(first.work.playhead, true);
  const idle = scheduler.tick({ ...request, now: 1000 / 144 }, adapter);
  assert.equal(idle.work.timeline, false);
  assert.equal(idle.work.playhead, false);
  assert.equal(idle.status, "hidden");
  const moved = scheduler.tick({ ...request, now: 2000 / 144, seconds: 0.1 }, adapter);
  assert.equal(moved.work.playhead, true);
});
