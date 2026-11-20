/** Panel scales paint authored sizes, and the launch size follows a display. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  LAYOUT_REGIONS,
  formatScale,
  regionBounds,
  regionPixels,
  regionScale,
  scaleForPixels,
} from "../../../core/shell/layoutProportions.ts";
import { automaticWindowSize } from "../../../frontend/platform/desktop/windowDisplay.ts";
import { settingsRegistry } from "../../../core/settings/settings.ts";
import "../../../core/settings/features/layout.ts";

const desktop = { width: 1440, height: 900 };

test("a fresh profile paints the authored density at any window size", () => {
  for (const region of Object.values(LAYOUT_REGIONS)) {
    assert.equal(region.defaultScale, 1, region.key);
    assert.equal(regionPixels(region, 1, desktop), region.basePixels, region.key);
    assert.equal(regionScale(region, 1, desktop), 1, region.key);
  }
  // The same profile on a large display keeps the same panel size, so the extra
  // pixels go to the workspace instead of inflating the chrome.
  const large = { width: 2560, height: 1440 };
  for (const region of Object.values(LAYOUT_REGIONS)) {
    assert.equal(regionPixels(region, 1, large), region.basePixels, region.key);
  }
});

test("the authored sizes are the compact desktop density", () => {
  assert.equal(LAYOUT_REGIONS.toolbar.basePixels, 90);
  assert.equal(LAYOUT_REGIONS.statusbar.basePixels, 36);
  assert.equal(LAYOUT_REGIONS.inspector.basePixels, 400);
  assert.equal(LAYOUT_REGIONS.sidebar.basePixels, 56);
});

test("a scale grows the box and its contents together", () => {
  const half = regionPixels(LAYOUT_REGIONS.inspector, 1.5, desktop);
  assert.equal(half, 600);
  // The contents factor is what the stylesheet multiplies authored tokens by, so
  // the panel never gains empty space around fixed-size contents.
  assert.equal(regionScale(LAYOUT_REGIONS.inspector, 1.5, desktop), 1.5);
  assert.equal(regionPixels(LAYOUT_REGIONS.toolbar, 0.62, desktop), 55.8);
  assert.equal(regionScale(LAYOUT_REGIONS.toolbar, 0.62, desktop), 0.62);
});

test("the adjustable range is wide enough to matter", () => {
  for (const region of Object.values(LAYOUT_REGIONS)) {
    assert.ok(region.minScale <= 0.9, `${region.key} should shrink`);
    assert.ok(region.maxScale >= 1.6, `${region.key} should grow`);
  }
});

test("a scale outside the range lands on the nearest accepted value", () => {
  assert.equal(
    regionPixels(LAYOUT_REGIONS.toolbar, 10, desktop),
    regionPixels(LAYOUT_REGIONS.toolbar, LAYOUT_REGIONS.toolbar.maxScale, desktop),
  );
  assert.equal(
    regionPixels(LAYOUT_REGIONS.toolbar, 0.01, desktop),
    regionPixels(LAYOUT_REGIONS.toolbar, LAYOUT_REGIONS.toolbar.minScale, desktop),
  );
});

test("an unreadable scale falls back to the authored size", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 0, -2]) {
    assert.equal(
      regionPixels(LAYOUT_REGIONS.toolbar, value, desktop),
      LAYOUT_REGIONS.toolbar.basePixels,
      String(value),
    );
  }
});

test("a wide inspector never takes more than 57% of a narrow window", () => {
  const narrow = { width: 600, height: 700 };
  assert.equal(regionBounds(LAYOUT_REGIONS.inspector, narrow).max, 342);
  // The box stops at the ceiling and the contents scale down with it, so nothing
  // spills out of the panel.
  assert.equal(regionPixels(LAYOUT_REGIONS.inspector, 1.9, narrow), 342);
  assert.equal(regionScale(LAYOUT_REGIONS.inspector, 1.9, narrow), 0.855);
});

test("a dragged pixel size round-trips into its scale", () => {
  const scale = scaleForPixels(LAYOUT_REGIONS.inspector, 500, desktop);
  assert.equal(formatScale(scale), "1.25");
  assert.equal(regionPixels(LAYOUT_REGIONS.inspector, scale, desktop), 500);
});

test("a dragged size stays inside the range the settings control accepts", () => {
  assert.equal(
    scaleForPixels(LAYOUT_REGIONS.inspector, 100, desktop),
    LAYOUT_REGIONS.inspector.minScale,
  );
  assert.equal(
    scaleForPixels(LAYOUT_REGIONS.inspector, 4000, desktop),
    LAYOUT_REGIONS.inspector.maxScale,
  );
});

test("stored scales keep a short decimal form", () => {
  assert.equal(formatScale(1), "1");
  assert.equal(formatScale(1.25), "1.25");
  assert.equal(formatScale(1.234567), "1.2346");
});

test("each region is a registered range row spanning its own range", () => {
  for (const region of Object.values(LAYOUT_REGIONS)) {
    const definition = settingsRegistry.definition(region.key);
    assert.ok(definition, region.key);
    assert.equal(definition.control, "range");
    assert.equal(definition.default, region.defaultScale);
    assert.equal(definition.min, region.minScale);
    assert.equal(definition.max, region.maxScale);
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
