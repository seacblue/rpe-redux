/** Verifies the public chart beat arithmetic helpers preserve exact triples. */
import assert from "node:assert/strict";
import test from "node:test";
import { chart } from "../../core/api/chart.ts";

test("chart.beats.addFraction preserves exact beat arithmetic", () => {
  assert.deepEqual(chart.beats.addFraction([2, 0, 1], 1, 2), {
    ok: true,
    value: [2, 1, 2],
  });
});

test("chart.beats.add and subtract preserve reduced triples", () => {
  assert.deepEqual(chart.beats.add([1, 1, 2], [0, 1, 2]), {
    ok: true,
    value: [2, 0, 1],
  });
  assert.deepEqual(chart.beats.subtract([3, 0, 1], [0, 1, 2]), {
    ok: true,
    value: [2, 1, 2],
  });
});

test("chart.beats rejects malformed triples", () => {
  const result = chart.beats.add([0, 0, 0], [0, 0, 1]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /valid beat triple/);
  }
});
