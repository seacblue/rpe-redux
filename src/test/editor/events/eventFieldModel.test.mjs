/** Event start and end values keep authored negatives and out-of-range numbers. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  eventFieldBounds,
  normalizeEventNumber,
  parseEventArray,
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
