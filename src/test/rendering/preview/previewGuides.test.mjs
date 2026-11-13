/** Verifies the guide merger keeps the linear-scan result after its spatial index. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeGuides,
  mergeGuidesInto,
} from "../../../frontend/screens/editor/workspace/preview/drawing/guides.ts";
import { drawGuides } from "../../../frontend/screens/editor/workspace/preview/drawing/previewGuides.ts";

function referenceMerge(guides, scale, enabled) {
  const groups = [];
  for (const guide of guides) {
    const group =
      enabled &&
      groups.find(
        (candidate) =>
          Math.hypot(candidate.x - guide.x, candidate.y - guide.y) < 10 * scale &&
          Math.abs(candidate.rotation - guide.rotation) < 0.01,
      );
    if (group) {
      group.indices.push(guide.index);
    } else {
      groups.push({ ...guide, indices: [guide.index] });
    }
  }
  return groups;
}

function sampleGuides(count) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    x: (index % 19) * 7 + (index % 3) * 0.25,
    y: (Math.floor(index / 19) % 17) * 6 + (index % 5) * 0.125,
    rotation: (index % 7) * 0.01,
  }));
}

test("guide merging matches the reference order at every list size", () => {
  for (const count of [1, 12, 40, 96, 420]) {
    const guides = sampleGuides(count);
    for (const enabled of [true, false]) {
      assert.deepEqual(
        mergeGuides(guides, 1.25, enabled).map((group) => group.indices),
        referenceMerge(guides, 1.25, enabled).map((group) => group.indices),
        `count=${count} enabled=${enabled}`,
      );
    }
  }
});

test("guide merging keeps non-finite guides out of the spatial index", () => {
  const guides = sampleGuides(96);
  guides[4] = { ...guides[4], x: Number.NaN };
  guides[70] = { ...guides[70], rotation: Number.POSITIVE_INFINITY };
  const merged = mergeGuides(guides, 1, true);
  assert.equal(
    merged.flatMap((group) => group.indices).length,
    guides.length,
    "every guide still belongs to exactly one group",
  );
  assert.equal(
    new Set(merged.flatMap((group) => group.indices)).size,
    guides.length,
    "no guide was dropped or duplicated",
  );
});

test("reused guide groups match fresh groups and retain their storage", () => {
  const first = sampleGuides(120);
  const second = sampleGuides(42).map((guide) => ({ ...guide, x: guide.x + 0.2 }));
  const groups = [];
  const firstResult = mergeGuidesInto(first, 1.25, true, groups);
  const firstStorage = firstResult.map((group) => group.indices);
  const actual = mergeGuidesInto(second, 1.25, true, groups);
  assert.deepEqual(
    actual.map((group) => group.indices),
    mergeGuides(second, 1.25, true).map((group) => group.indices),
  );
  assert.ok(actual.every((group) => firstStorage.includes(group.indices)));
});

test("static guide labels reuse one offscreen layer until the revision changes", () => {
  const previousDocument = globalThis.document;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  const previousWindow = globalThis.window;
  const targetCalls = { drawImage: 0, fillText: 0 };
  const layerCalls = { fillText: 0 };
  const makeContext = (calls) => {
    const canvas = { width: 100, height: 80 };
    return {
      canvas,
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      filter: "none",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      save() {},
      restore() {},
      setTransform() {},
      clearRect() {},
      measureText: (text) => ({
        width: text.length * 8,
        actualBoundingBoxLeft: 4,
        actualBoundingBoxRight: 4,
        actualBoundingBoxAscent: 12,
        actualBoundingBoxDescent: 4,
      }),
      fillText() {
        calls.fillText += 1;
      },
      translate() {},
      rotate() {},
      drawImage() {
        calls.drawImage = (calls.drawImage ?? 0) + 1;
      },
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill() {},
    };
  };
  const target = makeContext(targetCalls);
  const layer = makeContext(layerCalls);
  layer.canvas.getContext = () => layer;
  globalThis.document = {
    documentElement: {},
    createElement: () => layer.canvas,
  };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "#FFFFFF" });
  globalThis.window = { addEventListener() {} };
  try {
    const surface = {
      chart: { judgeLineList: [{}] },
      guides: [{ index: 0, x: 20, y: 30, rotation: 0 }],
      guideRevision: 1,
      lineNumbers: true,
      lineArrows: false,
      mergeLineNumbers: true,
      skin: null,
    };
    drawGuides(surface, target, 1, 0);
    drawGuides(surface, target, 1, 0);
    assert.equal(layerCalls.fillText, 1);
    assert.equal(targetCalls.fillText, 0);
    assert.equal(targetCalls.drawImage, 2);
    surface.guideRevision = 2;
    drawGuides(surface, target, 1, 0);
    assert.equal(layerCalls.fillText, 2);
    assert.equal(targetCalls.drawImage, 3);
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
