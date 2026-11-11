/** Event start and end values keep authored negatives and out-of-range numbers. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  eventFieldBounds,
  eventFieldNativeStep,
  normalizeEventNumber,
  parseEventArray,
  steppedEventValue,
} from "../../../frontend/screens/editor/inspector/events/eventFieldModel.ts";

test("event value fields carry no numeric bounds", () => {
  assert.deepEqual(eventFieldBounds("start"), {});
  assert.deepEqual(eventFieldBounds("end"), {});
});

test("negative and oversized event values are preserved", () => {
  assert.equal(normalizeEventNumber("start", -5), -5);
  assert.equal(normalizeEventNumber("end", 300), 300);
  assert.equal(normalizeEventNumber("start", -0.5), -0.5);
});

test("free event values use the native `any` step so no validation bubble appears", () => {
  assert.equal(eventFieldNativeStep("start", 5), "any");
  assert.equal(eventFieldNativeStep("end", 0.1), "any");
  assert.equal(eventFieldNativeStep("easingLeft", 0.05), 0.05);
  assert.equal(eventFieldNativeStep("linkgroup", 1), 1);
});

test("arrow stepping keeps the inspector's own step for free values", () => {
  assert.equal(steppedEventValue(-1, 5, -1), -6);
  assert.equal(steppedEventValue(0, 0.1, 1), 0.1);
  assert.equal(steppedEventValue(0, 0.1, 1, 10), 1);
});

test("easing and link-group fields keep their structural domains", () => {
  assert.deepEqual(eventFieldBounds("easingLeft"), { min: 0, max: 1 });
  assert.equal(normalizeEventNumber("easingRight", 2), 1);
  assert.equal(normalizeEventNumber("easingLeft", -1), 0);
  assert.deepEqual(eventFieldBounds("linkgroup"), { min: 0 });
  assert.equal(normalizeEventNumber("linkgroup", -3), 0);
});

test("colour triples keep the format's 0-255 channel domain", () => {
  assert.deepEqual(parseEventArray("-10, 300, 128"), [0, 255, 128]);
  assert.equal(parseEventArray("1, 2"), null);
  assert.equal(parseEventArray("1, 2, x"), null);
});
