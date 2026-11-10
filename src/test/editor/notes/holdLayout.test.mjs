/** Hold caps fit inside the start/end anchors and the body fills the remainder. */
import assert from "node:assert/strict";
import test from "node:test";
import { holdLayout } from "../../../frontend/screens/editor/canvas/noteGeometry.ts";

test("caps sit half a cap outside the anchors and the body spans the whole span", () => {
  const layout = holdLayout(100, 100, 100, 0, 20, 30);
  assert.deepEqual(layout.headCap, { x: 100, y: 110 });
  assert.deepEqual(layout.bodyHead, { x: 100, y: 100 });
  assert.deepEqual(layout.bodyTail, { x: 100, y: 0 });
  assert.deepEqual(layout.tailCap, { x: 100, y: -15 });
  assert.equal(layout.headCapLength, 20);
  assert.equal(layout.tailCapLength, 30);
  assert.equal(layout.bodyLength, 100);
});

test("a hidden head cap leaves the body spanning the head-to-tail anchors", () => {
  const layout = holdLayout(0, 0, 0, 100, 0, 25);
  assert.deepEqual(layout.headCap, { x: 0, y: 0 });
  assert.deepEqual(layout.bodyHead, { x: 0, y: 0 });
  assert.deepEqual(layout.bodyTail, { x: 0, y: 100 });
  assert.deepEqual(layout.tailCap, { x: 0, y: 112.5 });
  assert.equal(layout.bodyLength, 100);
});

test("a zero-length hold reports coincident caps and anchors", () => {
  const layout = holdLayout(7, 9, 7, 9, 20, 20);
  assert.deepEqual(layout.headCap, { x: 7, y: 9 });
  assert.deepEqual(layout.tailCap, { x: 7, y: 9 });
  assert.deepEqual(layout.bodyHead, { x: 7, y: 9 });
  assert.deepEqual(layout.bodyTail, { x: 7, y: 9 });
  assert.equal(layout.bodyLength, 0);
});

test("a zero-length hold puts the tail cap half a cap along the fall direction", () => {
  const layout = holdLayout(7, 9, 7, 9, 20, 20, { x: 0, y: 1 });
  assert.deepEqual(layout.headCap, { x: 7, y: -1 });
  assert.deepEqual(layout.tailCap, { x: 7, y: 19 });
  assert.equal(layout.bodyLength, 0);
});
