/** Vertical grid counts include both chart boundaries. */
import assert from "node:assert/strict";
import test from "node:test";
import { snapPosition, verticalGrid } from "../../../core/global/chart/editing/editGrid.ts";

test("grid counts preserve the centred layout for odd and even counts", () => {
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

  // An odd integer part keeps the centre line and divides both sides equally.
  const centred = verticalGrid(17.9);
  assert.equal(centred.lineCount, 17);
  assert.equal(centred.first, -8);
  assert.equal(centred.spacing, 1350 / 16);
  assert.equal(snapPosition(0, 17.9), 0);
  assert.equal(snapPosition(centred.spacing, 17.9), centred.spacing);
  assert.equal(snapPosition(-centred.spacing, 17.9), -centred.spacing);

  // An even integer part keeps the existing half-offset layout.
  const straddling = verticalGrid(18.9);
  assert.equal(straddling.lineCount, 18);
  assert.equal(straddling.first, -8.5);
  assert.equal(Math.abs(snapPosition(0, 18.9)), straddling.spacing / 2);
});

test("a grid count just below an integer does not lose its last line", () => {
  assert.equal(verticalGrid(3.5).lineCount, 3);
  assert.equal(verticalGrid(3.5).spacing, 675);
  assert.equal(verticalGrid(17.999).lineCount, 17);
});

test("the first and last lines are the chart boundaries", () => {
  const grid = verticalGrid(11);
  assert.equal((0 + grid.first) * grid.spacing, -675);
  assert.equal((grid.lineCount - 1 + grid.first) * grid.spacing, 675);
  assert.equal(snapPosition(-675, 11), -675);
  assert.equal(snapPosition(675, 11), 675);
});
