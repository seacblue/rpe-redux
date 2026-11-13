/**
 * Verifies preview judge lines use one batched sprite submission and keep the
 * Canvas path as the fallback whenever the batch cannot accept them.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { drawLinePasses } from "../../../frontend/screens/editor/workspace/preview/drawing/previewLines.ts";
import {
  DEFAULT_LINE_HEIGHT,
  DEFAULT_LINE_WIDTH,
} from "../../../frontend/screens/editor/workspace/preview/scene/constants.ts";
import { NoteSpriteGroups } from "../../../frontend/screens/editor/canvas/noteSpriteGroups.ts";

test("default judge lines batch once and fall back to Canvas when disabled", () => {
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
      scale: (x, y) => calls.push(["scale", x, y]),
      fillRect() {
        calls.push("fillRect");
      },
      drawImage() {
        calls.push("drawImage");
      },
      fillText() {
        calls.push("fillText");
      },
    };
    const state = {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      alpha: 255,
      color: [255, 128, 0, 1],
    };
    const lineDescriptor = {
      source: { naturalWidth: DEFAULT_LINE_WIDTH, naturalHeight: DEFAULT_LINE_HEIGHT },
      useful: { x: 0, y: 0, width: DEFAULT_LINE_WIDTH, height: DEFAULT_LINE_HEIGHT },
    };
    const addLineCalls = [];
    const surface = {
      noteBatch: {
        isActive: () => true,
        addLine: (...args) => {
          addLineCalls.push(args);
          return true;
        },
      },
      lineBatchable: true,
      passes: [{ kind: "line", index: 0, depth: 0 }],
      noteOpacity: 1,
      selectedLines: [],
      selectedLineColor: [],
      selectedNotes: new Map(),
      simultaneous: null,
      noteSize: 175,
      lineFrames: [],
      noteHitAreas: [],
      collectGeometry: false,
      lineScale: 1,
      skin: {
        lineTexture: () => lineDescriptor,
        tinted: () => null,
        drawAligned: () => false,
      },
    };
    const runtime = { line: {}, noteState: () => state };
    const frame = {
      context,
      chart: { judgeLineList: [{}] },
      states: [state],
      order: [0],
      visibleNotes: [[]],
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

    const batched = drawLinePasses(surface, frame);
    assert.equal(batched.lines, 1);
    assert.deepEqual(calls, []);
    assert.equal(addLineCalls.length, 1);
    const [descriptorArg, centerX, centerY, width, height, rotation, alpha, color] =
      addLineCalls[0];
    assert.equal(descriptorArg, lineDescriptor);
    assert.equal(centerX, 50);
    assert.equal(centerY, 50);
    assert.equal(width, DEFAULT_LINE_WIDTH);
    assert.equal(height, DEFAULT_LINE_HEIGHT);
    assert.equal(rotation, 0);
    assert.equal(alpha, 1);
    assert.deepEqual(color.color, [255, 128, 0]);

    addLineCalls.length = 0;
    surface.noteBatch.addLine = () => false;
    const fallback = drawLinePasses(surface, frame);
    assert.equal(fallback.lines, 1);
    assert.equal(addLineCalls.length, 0);
    assert.deepEqual(calls, [
      "save",
      ["translate", 50, 50],
      ["rotate", 0],
      "save",
      ["scale", 1, 1],
      "fillRect",
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

test("line groups share reset and clear with the note layers", () => {
  const groups = new NoteSpriteGroups();
  const descriptor = {
    source: {},
    useful: { x: 0, y: 0, width: 1, height: 1 },
  };
  const line = groups.lineGroup(descriptor);
  const hold = groups.group(descriptor, 0, false);
  line.count = 3;
  hold.count = 2;

  groups.reset();
  assert.equal(line.count, 0);
  assert.equal(hold.count, 0);

  groups.clear();
  assert.equal(groups.line.size, 0);
  assert.equal(groups.layers[0].size, 0);
});
