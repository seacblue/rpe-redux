/** Pointer-to-value mapping for range sliders: endpoints, step snapping, and guards. */
import assert from "node:assert/strict";
import test from "node:test";
import { trackBounds, valueAtPointer } from "../../../design/controls/sliderMode.ts";

const box = { left: 100, width: 200 };

test("the left edge maps to min and the right edge maps to max", () => {
  assert.equal(valueAtPointer(box, 0, 10, "1", 100), 0);
  assert.equal(valueAtPointer(box, 0, 10, "1", 300), 10);
});

test("points outside the box still clamp to an endpoint", () => {
  assert.equal(valueAtPointer(box, 0, 10, "1", 0), 0);
  assert.equal(valueAtPointer(box, 0, 10, "1", 400), 10);
  assert.equal(valueAtPointer(box, 0, 10, "1", Number.NEGATIVE_INFINITY), 0);
  assert.equal(valueAtPointer(box, 0, 10, "1", Number.POSITIVE_INFINITY), 10);
});

test("the endpoint wins even when max is not on the step grid", () => {
  assert.equal(valueAtPointer({ left: 0, width: 100 }, 0, 1, "0.3", 100), 1);
});

test("the middle of the box maps to the middle of the range", () => {
  assert.equal(valueAtPointer(box, 0, 10, "1", 200), 5);
});

test("a unit step snaps to the nearest grid point", () => {
  assert.equal(valueAtPointer(box, 0, 10, "1", 149), 2);
  assert.equal(valueAtPointer(box, 0, 10, "1", 160), 3);
});

test("a tenth step snaps without floating-point residue", () => {
  const bounds = { left: 0, width: 100 };
  assert.equal(valueAtPointer(bounds, 0, 1, "0.1", 30), 0.3);
  assert.equal(valueAtPointer(bounds, 0, 1, "0.1", 44), 0.4);
  assert.equal(valueAtPointer(bounds, 0, 1, "0.1", 46), 0.5);
  assert.equal(valueAtPointer(bounds, 0, 1, "0.1", 70), 0.7);
});

test("a non-zero min is the origin of the step grid", () => {
  const bounds = { left: 0, width: 300 };
  assert.equal(valueAtPointer(bounds, 0.5, 2, "0.1", 0), 0.5);
  assert.equal(valueAtPointer(bounds, 0.5, 2, "0.1", 75), 0.9);
  assert.equal(valueAtPointer(bounds, 0.5, 2, "0.1", 150), 1.3);
  assert.equal(valueAtPointer(bounds, 0.5, 2, "0.1", 300), 2);
});

test("a missing step and step=any snap to hundredths", () => {
  const bounds = { left: 0, width: 100 };
  assert.equal(valueAtPointer(bounds, 0, 1, "any", 33), 0.33);
  assert.equal(valueAtPointer(bounds, 0, 1, "", 67), 0.67);
});

test("a non-positive width falls back to min", () => {
  assert.equal(valueAtPointer({ left: 100, width: 0 }, 5, 10, "1", 150), 5);
  assert.equal(valueAtPointer({ left: 100, width: -20 }, 5, 10, "1", 150), 5);
});

test("non-finite input does not produce NaN", () => {
  assert.equal(valueAtPointer(box, 3, 7, "1", Number.NaN), 3);
  assert.equal(valueAtPointer({ left: Number.NaN, width: 200 }, 3, 7, "1", 150), 3);
  assert.equal(valueAtPointer(box, Number.NaN, 7, "1", 100), 0);
  assert.equal(valueAtPointer(box, 3, Number.NaN, "1", 200), 3);
});

test("the painted track's edges map to the ends, not the input's border box", () => {
  // A 1px border and 2px padding on both sides. The rail is what the user sees
  // and drags, so its first pixel is the start and its last pixel is the end.
  const insets = { borderLeft: 1, borderRight: 1, paddingLeft: 2, paddingRight: 2 };
  const rail = trackBounds({ left: 100, width: 206 }, insets);
  assert.equal(rail.left, 103);
  assert.equal(rail.width, 200);
  assert.equal(valueAtPointer(rail, 0, 600, "0.001", 103), 0);
  assert.equal(valueAtPointer(rail, 0, 600, "0.001", 303), 600);
  // The border itself is outside the track and still clamps to the start.
  assert.equal(valueAtPointer(rail, 0, 600, "0.001", 100), 0);
});

test("a track that collapses reports no width so the caller uses the endpoint rule", () => {
  const insets = { borderLeft: 20, borderRight: 20, paddingLeft: 0, paddingRight: 0 };
  assert.equal(trackBounds({ left: 100, width: 40 }, insets).width, 0);
  assert.equal(trackBounds({ left: 100, width: 30 }, insets).width, 0);
});
