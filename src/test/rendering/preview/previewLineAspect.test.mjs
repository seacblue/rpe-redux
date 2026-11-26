/** Verifies preview notes stay on tilted judge lines under non-uniform frame scaling. */
import assert from "node:assert/strict";
import test from "node:test";
import { drawLinePasses } from "../../../frontend/screens/editor/workspace/preview/drawing/previewLines.ts";

test("tilted preview notes use the judge-line screen transform", () => {
  const previousDocument = globalThis.document;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  const previousWindow = globalThis.window;
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "#FFFFFF" });
  globalThis.window = { addEventListener() {} };
  try {
    const submitted = [];
    const rotation = (30 * Math.PI) / 180;
    const state = {
      x: 0,
      y: 0,
      rotation: 30,
      scaleX: 1,
      scaleY: 1,
      alpha: 255,
      color: [255, 255, 255, 1],
    };
    const entry = { note: { type: 1 }, noteIndex: 0 };
    const runtime = {
      line: {},
      noteState(_entry, _state, _seconds, target) {
        Object.assign(target, {
          x: 0,
          y: 100,
          tail: 100,
          size: 1,
          alpha: 1,
          skew: 0,
          showHead: true,
        });
        return target;
      },
    };
    const surface = {
      noteBatch: {
        isActive: () => true,
        addHeadSlotted: (...args) => {
          submitted.push(args);
          return true;
        },
        addHold: () => true,
      },
      noteTextures: [],
      lineBatchable: false,
      passes: [{ kind: "note", depth: 1000 }],
      noteOpacity: 1,
      selectedLines: [],
      selectedLineSet: new Set(),
      selectedLineColor: [],
      multiSelectLineColor: [],
      selectedNotes: new Map(),
      simultaneous: null,
      noteSize: 1,
      lineFrames: [],
      noteHitAreas: [],
      collectGeometry: false,
      skin: null,
    };
    const frame = {
      context: {},
      chart: { judgeLineList: [{}] },
      states: [state],
      order: [0],
      visibleNotes: [[entry]],
      visibleHolds: [[]],
      seconds: 0,
      selectedLine: -1,
      scale: 0.8,
      scaleX: 0.8,
      scaleY: 1,
      viewport: { left: 0, top: 0, width: 400, height: 300 },
      centerX: 100,
      centerY: 100,
      scene: { lines: [runtime] },
    };

    drawLinePasses(surface, frame);

    assert.equal(submitted.length, 1);
    const [, , , centerX, centerY, , actualRotation] = submitted[0];
    assert.ok(Math.abs(centerX - 150) < 1e-9);
    assert.ok(Math.abs(centerY - (100 - 100 * Math.cos(rotation))) < 1e-9);
    assert.ok(Math.abs(actualRotation - rotation) < 1e-9);
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
