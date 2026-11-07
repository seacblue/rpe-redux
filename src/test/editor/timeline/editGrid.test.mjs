/** RPE-style vertical grid counts define the selectable line positions. */
import assert from "node:assert/strict";
import test from "node:test";
import { snapPosition, verticalGrid } from "../../../core/global/chart/editing/editGrid.ts";

test("grid count follows RPE's one-line and two-boundary layout", () => {
  assert.deepEqual(verticalGrid(1), {
    spacing: 1350,
    first: 0,
    lineCount: 1,
  });
  assert.deepEqual(verticalGrid(2), {
    spacing: 1350,
    first: -0.5,
    lineCount: 2,
  });
  assert.deepEqual(verticalGrid(11), {
    spacing: 1350 / 10,
    first: -5,
    lineCount: 11,
  });
  assert.deepEqual(verticalGrid(10), {
    spacing: 1350 / 9,
    first: -4.5,
    lineCount: 10,
  });

  const five = verticalGrid(5);
  assert.equal(five.spacing, 337.5);
  assert.equal(snapPosition(-1000, 5), -675);
  assert.equal(snapPosition(1000, 5), 675);
  assert.equal(snapPosition(0, 5), 0);
});

test("invalid grid counts fall back to the single centre line", () => {
  assert.deepEqual(verticalGrid(0), {
    spacing: 1350,
    first: 0,
    lineCount: 1,
  });
});
