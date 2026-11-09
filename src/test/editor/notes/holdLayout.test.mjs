/** Hold caps fit inside the start/end anchors and the body fills the remainder. */
import assert from "node:assert/strict";
import test from "node:test";
import { holdLayout } from "../../../frontend/screens/editor/canvas/noteGeometry.ts";

test("caps occupy the ends of the anchor span and the body fills the middle", () => {
  const layout = holdLayout(100, 100, 100, 0, 20, 30);
  assert.deepEqual(layout.headCap, { x: 100, y: 90 });
  assert.deepEqual(layout.bodyHead, { x: 100, y: 80 });
  assert.deepEqual(layout.bodyTail, { x: 100, y: 30 });
  assert.deepEqual(layout.tailCap, { x: 100, y: 15 });
  assert.equal(layout.headCapLength, 20);
  assert.equal(layout.tailCapLength, 30);
  assert.equal(layout.bodyLength, 50);
});

test("a hidden head cap leaves the body starting at the head anchor", () => {
  const layout = holdLayout(0, 0, 0, 100, 0, 25);
  assert.deepEqual(layout.headCap, { x: 0, y: 0 });
  assert.deepEqual(layout.bodyHead, { x: 0, y: 0 });
  assert.deepEqual(layout.bodyTail, { x: 0, y: 75 });
  assert.deepEqual(layout.tailCap, { x: 0, y: 87.5 });
  assert.equal(layout.bodyLength, 75);
});

test("caps shrink together when their authored lengths exceed the span", () => {
  const layout = holdLayout(0, 0, 0, 40, 30, 30);
  assert.equal(layout.headCapLength, 20);
  assert.equal(layout.tailCapLength, 20);
  assert.equal(layout.bodyLength, 0);
  assert.deepEqual(layout.headCap, { x: 0, y: 10 });
  assert.deepEqual(layout.tailCap, { x: 0, y: 30 });
});

test("a zero-length hold reports coincident caps and anchors", () => {
  const layout = holdLayout(7, 9, 7, 9, 20, 20);
  assert.deepEqual(layout.headCap, { x: 7, y: 9 });
  assert.deepEqual(layout.tailCap, { x: 7, y: 9 });
  assert.deepEqual(layout.bodyHead, { x: 7, y: 9 });
  assert.deepEqual(layout.bodyTail, { x: 7, y: 9 });
  assert.equal(layout.bodyLength, 0);
});
