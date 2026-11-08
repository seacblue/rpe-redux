/** Verifies background task details can change while retaining their lifecycle. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireLongTaskFence,
  finishLongTask,
  getLongTasks,
  removeLongTask,
  startLongTask,
  dismissLongTask,
  setLongTaskBootState,
} from "../../../core/state/longTasks.ts";

test("does not start work while the application is stuck on startup", () => {
  let ran = false;
  setLongTaskBootState("failed");
  assert.throws(
    () =>
      startLongTask({
        label: "blocked",
        run: async () => {
          ran = true;
        },
      }),
    /long_tasks_blocked_for_startup/,
  );
  assert.equal(ran, false);
  setLongTaskBootState("ready");
});

test("cancels active work when startup fails", async () => {
  let release;
  let signal;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const id = startLongTask({
    label: "active",
    run: async (context) => {
      signal = context.signal;
      await waiting;
    },
  });
  await Promise.resolve();
  setLongTaskBootState("failed");
  assert.equal(signal.aborted, true);
  assert.equal(getLongTasks().find((task) => task.id === id)?.status, "cancelling");
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  setLongTaskBootState("ready");
});

test("removing active work aborts it and retains the row until cleanup", async () => {
  let release;
  const cleanup = new Promise((resolve) => {
    release = resolve;
  });
  let signal;
  const id = startLongTask({
    label: "active",
    async run(context) {
      signal = context.signal;
      await cleanup;
    },
  });
  await Promise.resolve();
  removeLongTask(id);
  removeLongTask(id);
  assert.equal(signal.aborted, true);
  assert.equal(getLongTasks().find((task) => task.id === id)?.status, "cancelling");
  assert.equal(acquireLongTaskFence(), null);
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    getLongTasks().some((task) => task.id === id),
    false,
  );
});

test("publishes a streaming path and restores the destination on completion", async () => {
  let finish;
  const waiting = new Promise((resolve) => {
    finish = resolve;
  });
  const id = startLongTask({
    label: "recording",
    detail: "final.mp4",
    async run({ setDetail }) {
      setDetail("partial.mp4");
      await waiting;
      setDetail("final.mp4");
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(getLongTasks().find((task) => task.id === id)?.detail, "partial.mp4");
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const task = getLongTasks().find((item) => item.id === id);
  assert.equal(task?.detail, "final.mp4");
  assert.equal(task?.status, "completed");
  dismissLongTask(id);
});

test("finishLongTask records the terminal status a caller chose", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const id = startLongTask({ label: "import", run: async () => pending });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(getLongTasks().find((task) => task.id === id)?.status, "running");
  finishLongTask(id, { status: "completed", stage: "done" });
  const finished = getLongTasks().find((task) => task.id === id);
  assert.equal(finished?.stage, "done");
  assert.equal(typeof finished?.finishedAt, "number");
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  // The lifecycle's own outcome lands last and stays the authority for a run
  // that settled after the caller's summary.
  assert.equal(getLongTasks().find((task) => task.id === id)?.status, "completed");
  dismissLongTask(id);
});

test("handoff fence rejects new work and refuses while an existing task is active", async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const id = startLongTask({ label: "active", run: async () => pending });
  assert.equal(acquireLongTaskFence(), null);
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const release = acquireLongTaskFence();
  assert.equal(typeof release, "function");
  assert.throws(
    () => startLongTask({ label: "blocked", run: async () => {} }),
    /long_tasks_blocked_for_update/,
  );
  release();
  release();
  const next = startLongTask({ label: "allowed", run: async () => {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  dismissLongTask(id);
  dismissLongTask(next);
});
