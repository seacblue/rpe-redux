/** Window resolution settings stay bounded before reaching the native window API. */
import assert from "node:assert/strict";
import test from "node:test";
import { parseWindowResolution } from "../../frontend/platform/desktop/windowDisplay.ts";

test("parseWindowResolution accepts positive width and height", () => {
  assert.deepEqual(parseWindowResolution("1920x1080"), { width: 1920, height: 1080 });
  assert.deepEqual(parseWindowResolution(" 1280x720 "), { width: 1280, height: 720 });
});

test("parseWindowResolution rejects automatic and malformed values", () => {
  assert.equal(parseWindowResolution("auto"), null);
  assert.equal(parseWindowResolution("1920"), null);
  assert.equal(parseWindowResolution("0x1080"), null);
  assert.equal(parseWindowResolution("1920x0"), null);
});
