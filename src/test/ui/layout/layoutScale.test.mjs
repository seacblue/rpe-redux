/** Every host paints the authored chrome at one factor, and the window factor is proportional. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  LAYOUT_HOST_SCALE,
  LAYOUT_REFERENCE_HEIGHT,
  LAYOUT_REFERENCE_WIDTH,
  hostLayoutScale,
  viewportLayoutScale,
} from "../../../frontend/app/layout/layoutScale.ts";

test("both hosts paint the authored chrome a quarter larger", () => {
  assert.equal(LAYOUT_HOST_SCALE, 1.25);
  // The desktop app and the web page share one factor, so a profile paints the
  // same size in either host.
  assert.equal(hostLayoutScale(), 1.25);
});

test("the window factor is directly proportional and has no band", () => {
  // The reference window paints the authored factor.
  assert.equal(viewportLayoutScale(LAYOUT_REFERENCE_WIDTH, LAYOUT_REFERENCE_HEIGHT), 1);
  // The smaller dimension decides, so a short window never outgrows its height.
  assert.equal(viewportLayoutScale(1920, 1080), 1.2);
  assert.equal(viewportLayoutScale(1440, 1080), 1);
  // There is no lower or upper clamp: half the window is half the chrome, twice
  // the window is twice the chrome.
  assert.equal(viewportLayoutScale(720, 450), 0.5);
  assert.equal(viewportLayoutScale(1280, 720), 0.8);
  assert.equal(viewportLayoutScale(2560, 1440), 1.6);
  assert.equal(viewportLayoutScale(5760, 3600), 4);
  assert.equal(viewportLayoutScale(0, 900), 1);
  assert.equal(viewportLayoutScale(1440, Number.NaN), 1);
  // A small resize changes the factor by a small amount instead of jumping.
  const smaller = viewportLayoutScale(1400, 900);
  const larger = viewportLayoutScale(1410, 900);
  assert.ok(larger > smaller);
  assert.ok(larger - smaller < 0.01);
});
