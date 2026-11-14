/** Exercises local byte budgets, path caching, failure classification, and load fallback. */
import assert from "node:assert/strict";
import test from "node:test";
import { ByteBudget } from "../../../core/io/budget.ts";
import {
  classifyStorageFailure,
  isRetryableStorageFailure,
  isStorageFailure,
} from "../../../core/io/failures.ts";
import { PathCache } from "../../../core/io/pathCache.ts";
import { ResourceState } from "../../../core/io/resourceState.ts";

test("byte budgets reserve all-or-nothing and report pressure", () => {
  const budget = new ByteBudget({ limit: 100, warningAt: 0.8 });
  assert.equal(budget.pressure, "normal");
  assert.equal(budget.reserve(80), true);
  assert.equal(budget.pressure, "warning");
  assert.equal(budget.reserve(30), false);
  assert.equal(budget.used, 80);
  assert.equal(budget.reserve(20), true);
  assert.equal(budget.pressure, "full");
  budget.release(30);
  assert.equal(budget.available, 30);
  assert.equal(budget.reserve(31), false);
});

test("path cache normalizes once and evicts least-recently used entries", () => {
  const cache = new PathCache(2);
  assert.equal(cache.normalize("C:\\Songs\\..\\Cover.PNG"), "c:/cover.png");
  assert.equal(cache.normalize("C:\\Songs\\..\\Cover.PNG"), "c:/cover.png");
  cache.set("a", "first");
  cache.set("b", "second");
  assert.equal(cache.get("a"), "first");
  cache.set("c", "third");
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), "first");
});

test("storage failures keep quota, permission, and read-only distinct", () => {
  assert.deepEqual(classifyStorageFailure({ code: "disk_full" }), {
    kind: "quota",
    retryable: false,
    code: "disk_full",
  });
  assert.equal(classifyStorageFailure(new Error("EACCES: permission denied")).kind, "permission");
  assert.equal(classifyStorageFailure(new Error("read-only file system")).kind, "read-only");
  assert.equal(classifyStorageFailure(new Error("database is locked")).kind, "busy");
  assert.equal(isRetryableStorageFailure(new Error("database is locked")), true);
  assert.equal(isRetryableStorageFailure(new Error("no space left on device")), false);
  assert.equal(isStorageFailure(new Error("no space left on device")), true);
  assert.equal(isStorageFailure(new Error("network unreachable")), false);
});

test("resource state publishes ready, then keeps a stale value on failure", async () => {
  let fail = false;
  const state = new ResourceState({
    initial: null,
    load: async () => {
      if (fail) {
        throw new Error("service down");
      }
      return ["first"];
    },
    fallback: (_error, previous) => previous,
  });
  const phases = [];
  state.subscribe(() => phases.push(state.getSnapshot().phase));
  assert.deepEqual(await state.load(), ["first"]);
  assert.equal(state.getSnapshot().phase, "ready");
  fail = true;
  assert.deepEqual(await state.load(), ["first"]);
  const snapshot = state.getSnapshot();
  assert.equal(snapshot.phase, "degraded");
  assert.equal(snapshot.stale, true);
  assert.deepEqual(snapshot.value, ["first"]);
  assert.match(snapshot.error, /service down/);
  assert.deepEqual(phases.slice(0, 2), ["loading", "ready"]);
  assert.deepEqual(phases.slice(-2), ["degraded", "degraded"]);
});

test("resource state reports a first-load failure and ignores a superseded load", async () => {
  let resolveFirst;
  let resolveSecond;
  let call = 0;
  const state = new ResourceState({
    initial: null,
    load: () => {
      call += 1;
      return new Promise((resolve) => {
        if (call === 1) {
          resolveFirst = resolve;
        } else {
          resolveSecond = resolve;
        }
      });
    },
  });
  const first = state.load();
  await Promise.resolve();
  state.cancel();
  const second = state.load();
  await Promise.resolve();
  resolveSecond("new");
  assert.equal(await second, "new");
  resolveFirst("old");
  assert.equal(await first, "new");
  assert.equal(state.getSnapshot().phase, "ready");
  assert.equal(state.getSnapshot().value, "new");

  const failed = new ResourceState({
    initial: null,
    load: async () => {
      throw new Error("missing");
    },
  });
  assert.equal(await failed.load(), null);
  assert.equal(failed.getSnapshot().phase, "failed");
  assert.equal(failed.getSnapshot().error, "missing");
});

test("resource state can publish an optimistic mutation without another read", async () => {
  let loads = 0;
  const state = new ResourceState({
    initial: ["keep", "remove"],
    load: async () => {
      loads += 1;
      return ["from-service"];
    },
  });
  state.replace(["keep"]);
  assert.deepEqual(state.getSnapshot().value, ["keep"]);
  assert.equal(loads, 0);
  assert.equal(state.getSnapshot().phase, "ready");
  await state.load();
  assert.equal(loads, 1);
});
