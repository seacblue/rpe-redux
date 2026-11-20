/**
 * Numeric labels keep their glyph width: an overlong value loses decimal places
 * one at a time, and a value that still does not fit is returned unchanged so
 * the caller can draw it at full width.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { fitNumericText } from "../../../frontend/screens/editor/canvas/numericText.ts";

const measure = (text) => text.length * 10;

test("a value that fits is returned unchanged", () => {
  assert.equal(fitNumericText("123.45", 60, measure), "123.45");
});

test("decimal places are removed one at a time", () => {
  assert.equal(fitNumericText("123.456", 60, measure), "123.45");
  assert.equal(fitNumericText("123.456", 50, measure), "123.4");
  assert.equal(fitNumericText("123.456", 30, measure), "123");
});

test("negative values keep their sign", () => {
  assert.equal(fitNumericText("-12.34", 50, measure), "-12.3");
});

test("multiple decimal numbers are shortened together", () => {
  assert.equal(fitNumericText("1.234 - 5.678", 100, measure), "1.2 - 5.6");
});

test("integer text is returned unchanged when it does not fit", () => {
  assert.equal(fitNumericText("123456", 20, measure), "123456");
});

test("a value whose integer form is still too wide is returned unchanged", () => {
  assert.equal(fitNumericText("12345.67", 20, measure), "12345.67");
});
