/** Guards compound field rows from inheriting a whole-row disabled state. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fieldRow = new URL("../../../design/components/field/FieldRow.tsx", import.meta.url);
const fieldStyles = new URL("../../../design/components/field/field.less", import.meta.url);
const easingField = new URL("../../../design/components/easing/EasingField.tsx", import.meta.url);

test("compound easing rows opt out of whole-row disabled styling", async () => {
  const [component, styles, easing] = await Promise.all([
    readFile(fieldRow, "utf8"),
    readFile(fieldStyles, "utf8"),
    readFile(easingField, "utf8"),
  ]);
  assert.match(component, /partialDisabled\?: boolean/);
  assert.match(
    styles,
    /:has\(:is\(input, select, textarea, button\):disabled\):not\(\[data-partial-disabled="true"\]\)/,
  );
  assert.match(easing, /partialDisabled=\{!disabled && directionControl\.disabled\}/);
  assert.ok(
    easing.indexOf('className="easing-field-direction"') <
      easing.indexOf('className="easing-field-family"'),
    "the direction selector should precede the easing family selector",
  );
});
