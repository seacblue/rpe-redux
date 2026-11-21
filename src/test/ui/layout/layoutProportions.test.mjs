/** Panel scales paint authored sizes, and the launch size follows a display. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LAYOUT_SCALE,
  LAYOUT_REGIONS,
  displayScale,
  formatScale,
  regionBounds,
  regionPixels,
  regionScale,
  scaleForPixels,
} from "../../../core/shell/layoutProportions.ts";
import { automaticWindowSize } from "../../../frontend/platform/desktop/windowDisplay.ts";
import { settingsRegistry } from "../../../core/settings/settings.ts";
import "../../../core/settings/features/layout.ts";

const desktop = { width: 1440, height: 900, density: 1 };
const retina = { width: 1440, height: 900, density: 1.5 };
const wide = { width: 1920, height: 1080, density: 1 };

test("a fresh profile paints three quarters of the authored size", () => {
  assert.equal(DEFAULT_LAYOUT_SCALE, 0.75);
  for (const region of Object.values(LAYOUT_REGIONS)) {
    assert.equal(region.defaultScale, DEFAULT_LAYOUT_SCALE, region.key);
    assert.equal(
      regionPixels(region, region.defaultScale, desktop),
      region.basePixels * 0.75,
      region.key,
    );
    assert.equal(regionScale(region, region.defaultScale, desktop), 0.75, region.key);
    // The authored size is still the reference the stylesheet and the slider
    // maximum read; it is only no longer where a fresh profile starts.
    assert.equal(regionPixels(region, 1, desktop), region.basePixels, region.key);
  }
  // The same profile on a large display keeps the same panel size, so the extra
  // pixels go to the workspace instead of inflating the chrome.
  const large = { width: 2560, height: 1440, density: 1 };
  for (const region of Object.values(LAYOUT_REGIONS)) {
    assert.equal(
      regionPixels(region, region.defaultScale, large),
      region.basePixels * 0.75,
      region.key,
    );
  }
});

test("a denser display paints every default at its density", () => {
  for (const region of Object.values(LAYOUT_REGIONS)) {
    assert.equal(
      regionPixels(region, region.defaultScale, retina),
      region.basePixels * 0.75 * 1.5,
      region.key,
    );
    assert.equal(regionScale(region, region.defaultScale, retina), 1.125, region.key);
  }
  // A missing density reads as the ordinary display instead of a zero-sized shell.
  assert.equal(
    regionPixels(LAYOUT_REGIONS.toolbar, DEFAULT_LAYOUT_SCALE, { width: 1440, height: 900 }),
    LAYOUT_REGIONS.toolbar.basePixels * 0.75,
  );
});

test("the web host and the window size multiply every painted size", () => {
  const web = { ...desktop, hostScale: 1.25 };
  const both = { ...desktop, hostScale: 1.25, viewportScale: 1.2 };
  assert.equal(displayScale(web), 1.25);
  assert.equal(displayScale(both), 1.5);
  // The web build starts a quarter larger than the desktop at the same window.
  assert.equal(regionPixels(LAYOUT_REGIONS.inspector, DEFAULT_LAYOUT_SCALE, web), 375);
  assert.equal(regionScale(LAYOUT_REGIONS.inspector, DEFAULT_LAYOUT_SCALE, web), 0.9375);
  // A larger window grows the same profile in both hosts.
  assert.equal(regionPixels(LAYOUT_REGIONS.toolbar, DEFAULT_LAYOUT_SCALE, both), 108);
  // The seam edits painted pixels, so the stored scale divides every factor out.
  const scale = scaleForPixels(LAYOUT_REGIONS.inspector, 375, web);
  assert.equal(formatScale(scale), "0.75");
  assert.equal(regionPixels(LAYOUT_REGIONS.inspector, scale, web), 375);
  // Unreadable factors read as one rather than erasing the panel.
  assert.equal(
    displayScale({ width: 1440, height: 900, density: 0, hostScale: -1, viewportScale: NaN }),
    1,
  );
});

test("the authored sizes are the compact desktop density", () => {
  assert.equal(LAYOUT_REGIONS.toolbar.basePixels, 96);
  assert.equal(LAYOUT_REGIONS.statusbar.basePixels, 36);
  assert.equal(LAYOUT_REGIONS.inspector.basePixels, 400);
  assert.equal(LAYOUT_REGIONS.sidebar.basePixels, 56);
  assert.equal(LAYOUT_REGIONS.progress.basePixels, 480);
  // The fresh-profile sizes are 25% smaller than the authored ones.
  assert.equal(regionPixels(LAYOUT_REGIONS.toolbar, DEFAULT_LAYOUT_SCALE, desktop), 72);
  assert.equal(regionPixels(LAYOUT_REGIONS.statusbar, DEFAULT_LAYOUT_SCALE, desktop), 27);
  assert.equal(regionPixels(LAYOUT_REGIONS.inspector, DEFAULT_LAYOUT_SCALE, desktop), 300);
  assert.equal(regionPixels(LAYOUT_REGIONS.sidebar, DEFAULT_LAYOUT_SCALE, desktop), 42);
  assert.equal(regionPixels(LAYOUT_REGIONS.progress, DEFAULT_LAYOUT_SCALE, desktop), 360);
});

test("a scale grows the box and its contents together", () => {
  const half = regionPixels(LAYOUT_REGIONS.inspector, 1.5, desktop);
  assert.equal(half, 600);
  // The content factor is what the stylesheet multiplies authored tokens by, so
  // the panel never gains empty space around fixed-size contents.
  assert.equal(regionScale(LAYOUT_REGIONS.inspector, 1.5, desktop), 1.5);
  assert.equal(regionPixels(LAYOUT_REGIONS.toolbar, 0.62, desktop), 59.52);
  assert.equal(regionScale(LAYOUT_REGIONS.toolbar, 0.62, desktop), 0.62);
  // Density is part of the painted factor, not a second transform applied later.
  assert.equal(regionPixels(LAYOUT_REGIONS.toolbar, 0.62, retina), 89.28);
  assert.equal(regionScale(LAYOUT_REGIONS.toolbar, 0.62, retina), 0.93);
});

test("the adjustable range is wide enough to matter", () => {
  for (const region of Object.values(LAYOUT_REGIONS)) {
    assert.ok(region.minScale <= 0.9, `${region.key} should shrink`);
    assert.ok(region.maxScale >= 1.6, `${region.key} should grow`);
  }
});

test("the status bar can compress to its own caption row", () => {
  assert.equal(LAYOUT_REGIONS.statusbar.minScale, 0.65);
  assert.equal(regionPixels(LAYOUT_REGIONS.statusbar, 0.65, desktop), 23.4);
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

test("an unreadable scale falls back to the fresh-profile size", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 0, -2]) {
    assert.equal(
      regionPixels(LAYOUT_REGIONS.toolbar, value, desktop),
      LAYOUT_REGIONS.toolbar.basePixels * DEFAULT_LAYOUT_SCALE,
      String(value),
    );
  }
});

test("a wide inspector never takes more than 57% of a narrow window", () => {
  const narrow = { width: 600, height: 700, density: 1 };
  assert.equal(regionBounds(LAYOUT_REGIONS.inspector, narrow).max, 342);
  // The box stops at the ceiling and the contents scale down with it, so nothing
  // spills out of the panel.
  assert.equal(regionPixels(LAYOUT_REGIONS.inspector, 1.9, narrow), 342);
  assert.equal(regionScale(LAYOUT_REGIONS.inspector, 1.9, narrow), 0.855);
});

test("a drag at the ceiling stops the box and its contents together", () => {
  const narrowRetina = { width: 600, height: 700, density: 1.25 };
  const atCeiling = scaleForPixels(LAYOUT_REGIONS.inspector, 4000, narrowRetina);
  // The stored scale stops below the settings control's own maximum because the
  // painted ceiling is reached first.
  assert.equal(formatScale(atCeiling), "0.684");
  assert.equal(regionPixels(LAYOUT_REGIONS.inspector, atCeiling, narrowRetina), 342);
  assert.equal(regionScale(LAYOUT_REGIONS.inspector, atCeiling, narrowRetina), 0.855);
  // A profile stored at the control's maximum paints the same box and the same
  // content factor, so dragging past the ceiling cannot reflow the inspector.
  assert.equal(regionPixels(LAYOUT_REGIONS.inspector, 1.9, narrowRetina), 342);
  assert.equal(regionScale(LAYOUT_REGIONS.inspector, 1.9, narrowRetina), 0.855);
});

test("a dragged pixel size round-trips into its scale", () => {
  const scale = scaleForPixels(LAYOUT_REGIONS.inspector, 500, desktop);
  assert.equal(formatScale(scale), "1.25");
  assert.equal(regionPixels(LAYOUT_REGIONS.inspector, scale, desktop), 500);
  // The pointer travels painted pixels; the stored value divides the density out
  // so the same profile keeps its authored size on another display.
  const retinaScale = scaleForPixels(LAYOUT_REGIONS.inspector, 600, retina);
  assert.equal(formatScale(retinaScale), "1");
  assert.equal(regionPixels(LAYOUT_REGIONS.inspector, retinaScale, retina), 600);
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
  // On a display whose window cap binds earlier, the stored value stops at the
  // painted ceiling rather than at the control's nominal maximum.
  assert.equal(formatScale(scaleForPixels(LAYOUT_REGIONS.inspector, 4000, retina)), "1.368");
});

test("the transport card keeps a floor above its own readouts", () => {
  assert.deepEqual(regionBounds(LAYOUT_REGIONS.progress, wide), { min: 312, max: 768 });
  // The floor is authored at the default toolbar scale, so it follows both the
  // density and the host toolbar's content factor.
  assert.equal(regionBounds(LAYOUT_REGIONS.progress, retina).min, 468);
  assert.equal(regionBounds(LAYOUT_REGIONS.progress, retina, 2.25).min, 702);
  const floored = scaleForPixels(LAYOUT_REGIONS.progress, 100, desktop, 2);
  assert.equal(formatScale(floored), "1.3");
  assert.equal(regionPixels(LAYOUT_REGIONS.progress, floored, desktop, 2), 624);
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
    assert.equal(definition.step, 0.01, `${region.key} uses the hundredth step`);
    // The native range snaps a value off its step grid, so the fresh-profile
    // default must be one of the stops the slider can actually paint.
    const stops = (definition.default - definition.min) / definition.step;
    assert.ok(
      Math.abs(stops - Math.round(stops)) < 1e-9,
      `${region.key} default lands on the slider grid`,
    );
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
