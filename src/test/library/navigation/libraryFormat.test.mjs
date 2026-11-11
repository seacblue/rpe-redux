/** Compact charting-duration formatting for the welcome statistics. */
import assert from "node:assert/strict";
import test from "node:test";
import { formatChartingTime } from "../../../frontend/screens/welcome/library/libraryFormat.ts";

test("charting time uses compact y/d/h/m/s parts", () => {
  assert.equal(formatChartingTime(0), "0s");
  assert.equal(formatChartingTime(59), "59s");
  assert.equal(formatChartingTime(60), "1m");
  assert.equal(formatChartingTime(3600), "1h");
  assert.equal(formatChartingTime(86400), "1d");
  assert.equal(formatChartingTime(365 * 86400), "1y");
  assert.equal(formatChartingTime(365 * 86400 + 86400 + 3661), "1y 1d 1h 1m 1s");
  assert.equal(formatChartingTime(365 * 86400 + 1), "1y 1s");
});

test("charting time floors and clamps invalid input", () => {
  assert.equal(formatChartingTime(59.9), "59s");
  assert.equal(formatChartingTime(-10), "0s");
  assert.equal(formatChartingTime(Number.NaN), "0s");
  assert.equal(formatChartingTime(Number.POSITIVE_INFINITY), "0s");
});
