/** Judge-line control tracks interpolate by note floor distance, not chart time. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  controlPointValue,
  controlTrackDomain,
  controlTrackValue,
} from "../../../core/global/chart/editing/controlTracks.ts";

test("a control track sorts points and clamps outside its endpoints", () => {
  const points = [
    { x: 100, pos: 2, easing: 1 },
    { x: 0, pos: 0, easing: 1 },
  ];
  assert.equal(controlTrackValue(points, "pos", 1, -10), 0);
  assert.equal(controlTrackValue(points, "pos", 1, 50), 1);
  assert.equal(controlTrackValue(points, "pos", 1, 150), 2);
  assert.equal(controlTrackValue([{ x: 4, skew: 12 }], "skew", 0, 999), 12);
  assert.equal(controlTrackValue([], "y", 1, 5), 1);
});

test("the domain ignores the synthetic endpoint and includes the neutral value", () => {
  const domain = controlTrackDomain(
    [
      { x: 0, y: 1 },
      { x: 200, y: 3 },
      { x: 9_999_999, y: 1 },
    ],
    "y",
    1,
  );
  assert.ok(domain.maxX < 1_000_000);
  assert.ok(domain.minY < 1);
  assert.ok(domain.maxY > 3);
});

test("a flat default track still gets a readable vertical span", () => {
  const domain = controlTrackDomain(
    [
      { x: 0, skew: 0 },
      { x: 9_999_999, skew: 0 },
    ],
    "skew",
    0,
  );
  assert.ok(domain.minY < 0);
  assert.ok(domain.maxY > 0);
});

test("missing values fall back to the track's neutral value", () => {
  assert.equal(controlPointValue({ x: 0 }, "alpha", 1), 1);
  assert.equal(controlPointValue({ x: 0, alpha: 0.5 }, "alpha", 1), 0.5);
});
