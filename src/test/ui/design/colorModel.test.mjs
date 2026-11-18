/** Colour swatch value rules: normalization and contrast ink selection. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  colorInk,
  displayHexColor,
  formatHexColor,
  normalizeColor,
  readColorDraft,
} from "../../../design/components/input/colorModel.ts";
import { sourceOverColor } from "../../../core/utils/colors.ts";

test("normalizes long, short, and invalid colour values", () => {
  assert.equal(normalizeColor("#a1b2c3"), "#A1B2C3");
  assert.equal(normalizeColor(" #abc "), "#AABBCC");
  assert.equal(normalizeColor("not-a-colour"), "#000000");
});

test("picks black ink for light swatches and white ink for dark swatches", () => {
  assert.equal(colorInk("#ffffff"), "dark");
  assert.equal(colorInk("#f5d76e"), "dark");
  assert.equal(colorInk("#000000"), "light");
  assert.equal(colorInk("#1b2b4b"), "light");
});

test("alpha colours keep RGB compatibility and format their readout", () => {
  assert.equal(normalizeColor("#12345680"), "#123456");
  assert.equal(formatHexColor("#123456", 0.5), "#12345680");
  assert.equal(formatHexColor("#123456", 1), "#123456");
  assert.equal(displayHexColor("#12345680"), "#123456 50%");
  assert.equal(displayHexColor("#123456"), "#123456");
});

test("a committed hex draft only carries the alpha it states", () => {
  assert.deepEqual(readColorDraft("#ff0000"), { red: 1, green: 0, blue: 0, alpha: undefined });
  assert.deepEqual(readColorDraft("#f00"), { red: 1, green: 0, blue: 0, alpha: undefined });
  assert.equal(readColorDraft("#ff000080")?.alpha, 128 / 255);
  assert.equal(readColorDraft("#f008")?.alpha, 136 / 255);
  assert.equal(readColorDraft("#12345"), null);
});

test("source-over colour mixing keeps the base line in the highlight result", () => {
  assert.equal(sourceOverColor("#000000", "#FFFFFF80", 0.9), "rgba(135,135,135,0.950196)");
});
