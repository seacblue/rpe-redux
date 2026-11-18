/** The offset commit keeps the chart position fixed by moving the audio clock. */
import assert from "node:assert/strict";
import test from "node:test";
import { offsetAnchorSeconds } from "../../../frontend/screens/editor/inspector/bpm/offsetAnchor.ts";

test("a larger offset moves the audio position later by the same amount", () => {
  assert.equal(offsetAnchorSeconds(10, 0.5), 10.5);
  assert.equal(offsetAnchorSeconds(10, -0.25), 9.75);
});

test("an offset change keeps the chart position, not the audio position", () => {
  const chartSeconds = 12;
  assert.equal(offsetAnchorSeconds(chartSeconds, 0.2) - 0.2, chartSeconds);
  assert.equal(offsetAnchorSeconds(chartSeconds, 1.4) - 1.4, chartSeconds);
});

test("a non-finite chart position or offset leaves the transport alone", () => {
  assert.equal(offsetAnchorSeconds(Number.NaN, 0.5), null);
  assert.equal(offsetAnchorSeconds(4, Number.NaN), null);
  assert.equal(offsetAnchorSeconds(Number.POSITIVE_INFINITY, 4), null);
});
