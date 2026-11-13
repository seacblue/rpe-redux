/** Import progress dialog arithmetic: percentages, counts, and status. */
import assert from "node:assert/strict";
import test from "node:test";
import { importProgressSnapshot } from "../../frontend/overlays/modals/importProgressModel.ts";

test("a running import reports its percentage and completed count", () => {
  assert.deepEqual(importProgressSnapshot(0.5, 82, "running"), {
    running: true,
    percent: 50,
    done: 41,
    valueText: "50%",
  });
  assert.deepEqual(importProgressSnapshot(0.006, 82, "running"), {
    running: true,
    percent: 1,
    done: 0,
    valueText: "1%",
  });
  assert.deepEqual(importProgressSnapshot(1, 82, "running"), {
    running: true,
    percent: 100,
    done: 82,
    valueText: "100%",
  });
});

test("cancelling still counts as running, and fractions clamp to 0-1", () => {
  assert.equal(importProgressSnapshot(0.25, 4, "cancelling").running, true);
  assert.equal(importProgressSnapshot(-1, 4, "running").percent, 0);
  assert.equal(importProgressSnapshot(-1, 4, "running").done, 0);
  assert.equal(importProgressSnapshot(2, 4, "running").percent, 100);
  assert.equal(importProgressSnapshot(2, 4, "running").done, 4);
});

test("a settled import is no longer running but keeps its last count", () => {
  const completed = importProgressSnapshot(1, 82, "completed");
  assert.equal(completed.running, false);
  assert.equal(completed.percent, 100);
  assert.equal(completed.done, 82);
  assert.equal(importProgressSnapshot(null, 82, "failed").running, false);
});

test("an unknown fraction stays indeterminate and a missing total stays zero", () => {
  assert.deepEqual(importProgressSnapshot(null, 82, "running"), {
    running: true,
    percent: null,
    done: 0,
    valueText: undefined,
  });
  assert.equal(importProgressSnapshot(0.5, 0, "running").done, 0);
  assert.equal(importProgressSnapshot(0.5, NaN, "running").done, 0);
  assert.equal(importProgressSnapshot(Number.NaN, 82, "running").percent, null);
});
