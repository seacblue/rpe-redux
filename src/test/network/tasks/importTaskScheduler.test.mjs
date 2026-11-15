/** Verifies memory-budgeted import admission and oversized-task ordering. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  IMPORT_SINGLE_TASK_MEMORY_LIMIT,
  IMPORT_TOTAL_MEMORY_BUDGET,
  ImportTaskScheduler,
} from "../../../frontend/screens/welcome/importTaskScheduler.ts";

const megabytes = (value) => value * 1024 * 1024;

test("admits ordinary imports only while the 512 MB budget has room", async () => {
  const scheduler = new ImportTaskScheduler([
    megabytes(128),
    megabytes(128),
    megabytes(128),
    megabytes(128),
    megabytes(128),
  ]);
  const signals = Array.from({ length: 5 }, () => new AbortController().signal);
  const permits = signals.map((signal, index) => scheduler.acquire(index, signal));
  await Promise.all(permits.slice(0, 4));
  assert.equal(scheduler.usedBytes, IMPORT_TOTAL_MEMORY_BUDGET);
  assert.equal(scheduler.runningCount, 4);

  let fifthStarted = false;
  void permits[4].then(() => {
    fifthStarted = true;
  });
  await Promise.resolve();
  assert.equal(fifthStarted, false);
  scheduler.release(0);
  await permits[4];
  assert.equal(scheduler.usedBytes, IMPORT_TOTAL_MEMORY_BUDGET);
});

test("defers oversized imports until ordinary work is settled", async () => {
  const oversized = megabytes(129);
  assert.ok(oversized > IMPORT_SINGLE_TASK_MEMORY_LIMIT);
  const scheduler = new ImportTaskScheduler([oversized, megabytes(128), megabytes(128)]);
  const signals = Array.from({ length: 3 }, () => new AbortController().signal);
  const permits = signals.map((signal, index) => scheduler.acquire(index, signal));

  await Promise.all([permits[1], permits[2]]);
  assert.equal(scheduler.runningCount, 2);
  let oversizedStarted = false;
  void permits[0].then(() => {
    oversizedStarted = true;
  });
  await Promise.resolve();
  assert.equal(oversizedStarted, false);

  scheduler.release(1);
  scheduler.release(2);
  await permits[0];
  assert.equal(oversizedStarted, true);
  assert.equal(scheduler.runningCount, 1);
  scheduler.release(0);
});

test("cancelling a queued task removes it from the budget queue", async () => {
  const scheduler = new ImportTaskScheduler([
    megabytes(128),
    megabytes(128),
    megabytes(128),
    megabytes(128),
    megabytes(128),
  ]);
  const controllers = Array.from({ length: 5 }, () => new AbortController());
  const permits = controllers.map((controller, index) =>
    scheduler.acquire(index, controller.signal),
  );
  await Promise.all(permits.slice(0, 4));
  controllers[4].abort();
  await assert.rejects(permits[4], { name: "AbortError" });
  assert.equal(scheduler.runningCount, 4);
  assert.equal(scheduler.usedBytes, IMPORT_TOTAL_MEMORY_BUDGET);
});
