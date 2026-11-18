/** Panel shares resolve to stable pixel sizes, and the launch size follows a display. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  LAYOUT_REGIONS,
  formatShare,
  regionBounds,
  regionPixels,
  shareForPixels,
} from "../../../core/shell/layoutProportions.ts";
import { automaticWindowSize } from "../../../frontend/platform/desktop/windowDisplay.ts";
import { settingsRegistry } from "../../../core/settings/settings.ts";
import "../../../core/settings/features/layout.ts";

const desktop = { width: 1440, height: 810 };

test("the default shares reproduce the resting window layout", () => {
  assert.equal(regionPixels(LAYOUT_REGIONS.toolbar, 0.131, desktop), 106.11);
  assert.equal(regionPixels(LAYOUT_REGIONS.statusbar, 0.0445, desktop), 36.05);
  assert.equal(regionPixels(LAYOUT_REGIONS.inspector, 0.278, desktop), 400.32);
  assert.equal(regionPixels(LAYOUT_REGIONS.sidebar, 0.039, desktop), 56.16);
});

test("a share grows with the window between a floor and a ceiling", () => {
  const small = { width: 1000, height: 680 };
  const large = { width: 2560, height: 1440 };
  assert.equal(regionPixels(LAYOUT_REGIONS.toolbar, 0.131, small), 94);
  assert.equal(regionPixels(LAYOUT_REGIONS.toolbar, 0.131, large), 188.64);
  assert.equal(regionPixels(LAYOUT_REGIONS.inspector, 0.45, large), 720);
  assert.deepEqual(regionBounds(LAYOUT_REGIONS.inspector, { width: 2000, height: 1000 }), {
    min: 260,
    max: 720,
  });
});

test("the inspector never takes more than 57% of a narrow window", () => {
  const narrow = { width: 400, height: 700 };
  assert.equal(regionBounds(LAYOUT_REGIONS.inspector, narrow).max, 228);
  assert.equal(regionPixels(LAYOUT_REGIONS.inspector, 0.278, narrow), 228);
});

test("a dragged pixel size round-trips into its share", () => {
  const share = shareForPixels(LAYOUT_REGIONS.inspector, 500, { width: 1600, height: 900 });
  assert.equal(formatShare(share), "0.3125");
  assert.equal(regionPixels(LAYOUT_REGIONS.inspector, share, { width: 1600, height: 900 }), 500);
});

test("a dragged size stays inside the range the settings control accepts", () => {
  assert.equal(
    shareForPixels(LAYOUT_REGIONS.inspector, 100, { width: 1600, height: 900 }),
    LAYOUT_REGIONS.inspector.minShare,
  );
  assert.equal(
    shareForPixels(LAYOUT_REGIONS.inspector, 4000, { width: 1600, height: 900 }),
    LAYOUT_REGIONS.inspector.maxShare,
  );
});

test("stored shares keep a short decimal form", () => {
  assert.equal(formatShare(0.278), "0.278");
  assert.equal(formatShare(0.27800000001), "0.278");
  assert.equal(formatShare(0.0445), "0.0445");
});

test("each region is a registered range row", () => {
  for (const region of Object.values(LAYOUT_REGIONS)) {
    const definition = settingsRegistry.definition(region.key);
    assert.ok(definition, region.key);
    assert.equal(definition.control, "range");
    assert.equal(definition.default, region.defaultShare);
    assert.equal(definition.min, region.minShare);
    assert.equal(definition.max, region.maxShare);
    assert.equal(definition.percentage, true);
  }
});

test("an automatic window keeps 70% of the display on its longest fitting axis", () => {
  assert.deepEqual(automaticWindowSize({ width: 1920, height: 1040, scaleFactor: 1 }), {
    width: 1294,
    height: 728,
  });
  assert.deepEqual(automaticWindowSize({ width: 3840, height: 2160, scaleFactor: 1 }), {
    width: 2688,
    height: 1512,
  });
});

test("an automatic window converts the work area through the display scale", () => {
  assert.deepEqual(automaticWindowSize({ width: 2560, height: 1400, scaleFactor: 1.5 }), {
    width: 1161,
    height: 680,
  });
  assert.deepEqual(
    automaticWindowSize({ width: 1920, height: 1040, scaleFactor: 0 }),
    automaticWindowSize({ width: 1920, height: 1040, scaleFactor: 1 }),
  );
});

test("the launch size never drops below the window minimum", () => {
  assert.deepEqual(automaticWindowSize({ width: 1366, height: 728, scaleFactor: 1 }), {
    width: 1000,
    height: 680,
  });
});
