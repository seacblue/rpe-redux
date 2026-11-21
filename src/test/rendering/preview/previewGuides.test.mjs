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

test("visible guide labels paint directly and off-screen labels are culled", () => {
  const previousDocument = globalThis.document;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  const previousWindow = globalThis.window;
  const calls = { fillText: 0, fillStyles: [] };
  const targetCanvas = { width: 100, height: 80 };
  const target = {
    canvas: targetCanvas,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "none",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    save() {},
    restore() {},
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
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {
      calls.fillStyles.push(target.fillStyle);
    },
  };
  globalThis.document = { documentElement: {} };
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
    assert.equal(calls.fillText, 1);
    drawGuides(surface, target, 1, 0);
    assert.equal(calls.fillText, 2);

    target.fillStyle = "#000000";
    drawGuides(
      {
        ...surface,
        lineNumbers: false,
        lineArrows: true,
      },
      target,
      1,
      0,
    );
    assert.equal(calls.fillStyles.at(-1), "#FFFFFF");

    surface.guides = [{ index: 0, x: 1000, y: 30, rotation: 0 }];
    surface.guideRevision = 2;
    drawGuides(surface, target, 1, 0);
    assert.equal(calls.fillText, 2);
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

/**
 * Paint one frame of guides against a recording Canvas2D stub.
 *
 * `sprite` stands in for the decoded pointer mask so the sprite path and the
 * drawn fallback can be compared through the same call.
 */
function paintPointer({ sprite = null, rotation = 0, size = 30 } = {}) {
  const previousDocument = globalThis.document;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  const previousWindow = globalThis.window;
  const calls = { drawn: [], path: [], fillStyles: [], translations: [], rotations: [] };
  let drawing = false;
  const closed = [];
  const target = {
    canvas: { width: 200, height: 200 },
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "none",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    save() {},
    restore() {},
    measureText: () => ({
      width: 8,
      actualBoundingBoxLeft: 4,
      actualBoundingBoxRight: 4,
      actualBoundingBoxAscent: 12,
      actualBoundingBoxDescent: 4,
    }),
    fillText() {},
    translate(x, y) {
      calls.translations.push([x, y]);
    },
    rotate(radians) {
      calls.rotations.push(radians);
    },
    drawImage(source, x, y, width, height) {
      calls.drawn.push({ source, x, y, width, height });
    },
    beginPath() {
      drawing = true;
      calls.path = [];
      closed.length = 0;
    },
    moveTo(x, y) {
      assert.ok(drawing, "moveTo outside a path");
      calls.path.push([x, y]);
    },
    lineTo(x, y) {
      assert.ok(drawing, "lineTo outside a path");
      calls.path.push([x, y]);
    },
    closePath() {
      closed.push(true);
    },
    fill() {
      calls.fillStyles.push(target.fillStyle);
    },
  };
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (name) => (name === "--canvas-preview-line-selected" ? "#00c800" : "#FFFFFF"),
  });
  globalThis.window = { addEventListener() {} };
  const surface = {
    chart: { judgeLineList: [{}] },
    guides: [{ index: 0, x: 100, y: 100, rotation }],
    guideRevision: 1,
    lineNumbers: false,
    lineArrows: true,
    mergeLineNumbers: true,
    skin: sprite ? { images: new Map([["line_pointer", sprite]]), colorized: () => sprite } : null,
  };
  try {
    drawGuides(surface, target, 1, 0);
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
  return { calls, closed: closed.length, size };
}

test("the pointer is an equilateral triangle based on the judge line", () => {
  const { calls } = paintPointer();
  // Vertices before the notch: the far foot, the apex, the near foot.
  const [far, apex, near] = calls.path;
  assert.equal(far[1], 0, "the far foot sits on the judge line");
  assert.equal(near[1], 0, "the near foot sits on the judge line");
  assert.ok(apex[1] < 0, "the apex rises above the line");
  const base = near[0] - far[0];
  const height = -apex[1];
  // An equilateral triangle's height is √3/2 of its base.
  assert.ok(
    Math.abs(height - (base * Math.sqrt(3)) / 2) < 0.01,
    `the outline is equilateral: base ${base}, height ${height}`,
  );
  assert.equal(apex[0], (far[0] + near[0]) / 2, "the apex is centred over the base");
});

test("the pointer's base is lifted off the judge line by its stand-off", () => {
  const { calls } = paintPointer();
  // The marker is translated to the line and then a second time along its own
  // normal, so the base never touches the line it identifies.
  const [toLine, standOff] = calls.translations;
  assert.deepEqual(toLine, [100, 100], "the marker starts at the line's anchor");
  assert.equal(standOff[0], 0, "the stand-off stays on the normal, not across it");
  // A quarter of the marker's size, which is what keeps the gap proportional.
  assert.deepEqual(standOff[1], -22.5 * 0.25, "the stand-off is a quarter of the marker");
});

test("the pointer notch keeps a reading at zero opacity", () => {
  const { calls, closed } = paintPointer();
  assert.equal(closed, 1, "the pointer is a single closed outline");
  const corners = calls.path;
  const onLine = corners.filter(([, y]) => y === 0).map(([x]) => x);
  // The notch is cut into the base, so two feet remain on the base row while
  // the notch apex lifts away from it.
  const mouth = onLine.filter((x) => Math.abs(x) < 12);
  assert.equal(mouth.length, 2, "the notch opens two mouths on the base");
  const notchApex = corners.find(([, y]) => y < 0 && y > -30);
  assert.ok(notchApex, "the notch apex is inside the body");
  assert.equal(notchApex[0], 0, "the notch is centred on the base");
  // Both feet lie beyond both mouths, so the notch is strictly narrower than
  // the marker's base.
  const feet = onLine.filter((x) => !mouth.includes(x));
  assert.equal(feet.length, 2, "the base keeps a foot beside each mouth");
  assert.ok(
    feet.every((foot) => mouth.every((edge) => Math.abs(foot) > Math.abs(edge))),
    "each foot reaches past the notch",
  );
});

test("the pointer points up the line's local normal", () => {
  const { calls } = paintPointer();
  const tip = calls.path.reduce((highest, point) => (point[1] < highest[1] ? point : highest));
  // A quarter smaller than the old 30px marker.
  assert.deepEqual(tip, [0, -22.5], "the apex is directly above the anchor");
  assert.equal(calls.fillStyles.length, 1, "the fallback fills exactly one shape");
});

test("the sprite path and the drawn fallback use the same anchor and extent", () => {
  const sprite = { width: 256, height: 256 };
  const painted = paintPointer({ sprite });
  assert.equal(painted.calls.drawn.length, 1, "a decoded sprite is drawn instead of traced");
  const [draw] = painted.calls.drawn;
  assert.equal(draw.source, sprite);
  // The sprite is centred on the anchor and spans twice the marker size, so its
  // base row lands exactly where the vector outline's base does.
  assert.deepEqual(
    [draw.x, draw.y, draw.width, draw.height],
    [-22.5, -22.5, 45, 45],
    "the sprite covers the same box as the fallback outline",
  );
  assert.equal(painted.calls.path.length, 0, "the fallback is not also painted");
});

test("the pointer follows the line rotation on both paths", () => {
  const angles = [];
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "#FFFFFF" });
  globalThis.window = { addEventListener() {} };
  try {
    const target = {
      canvas: { width: 200, height: 200 },
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      filter: "none",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      save() {},
      restore() {},
      measureText: () => ({
        width: 8,
        actualBoundingBoxLeft: 4,
        actualBoundingBoxRight: 4,
        actualBoundingBoxAscent: 12,
        actualBoundingBoxDescent: 4,
      }),
      fillText() {},
      translate() {},
      rotate(radians) {
        angles.push(radians);
      },
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill() {},
    };
    drawGuides(
      {
        chart: { judgeLineList: [{}] },
        guides: [{ index: 0, x: 100, y: 100, rotation: 90 }],
        guideRevision: 1,
        lineNumbers: false,
        lineArrows: true,
        mergeLineNumbers: true,
        skin: null,
      },
      target,
      1,
      0,
    );
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
  }
  assert.deepEqual(angles, [Math.PI / 2], "the marker rotates with its line");
});
