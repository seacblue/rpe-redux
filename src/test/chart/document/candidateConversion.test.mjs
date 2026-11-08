/** A converted candidate is saved once after its replacement leaves the queue. */
import assert from "node:assert/strict";
import test from "node:test";
import { createQueuedCandidateLoader } from "../../../frontend/screens/editor/workspace/document/lifecycle/queuedCandidateLoader.ts";

function harness(converted) {
  const events = [];
  const task = { complete() {}, fail() {}, update() {} };
  const load = {
    generation: 1,
    isCurrent: () => true,
    complete: () => true,
    restore: () => true,
    cancel: () => true,
  };
  const coordinator = {
    async submitReplacement(run) {
      events.push("replacement:start");
      await run(load);
      events.push("replacement:end");
      return { status: "accepted", value: undefined, state: {} };
    },
  };
  const loader = createQueuedCandidateLoader({
    coordinator,
    openDocument: async () => ({
      candidate: { chart: { META: { name: "old" } }, name: "old.json" },
      assets: new Map(),
      task,
    }),
    loadCandidateResources: async () => events.push("resources"),
    prepareCandidate: async (candidate) => ({ ...candidate, converted }),
    commitConverted: async () => events.push("commit"),
    currentChartFingerprint: () => "fingerprint",
    currentDiskSnapshot: () => null,
    currentChartName: () => "old.json",
    currentPath: () => null,
    currentChart: () => ({ chart: true }),
  });
  return { loader, events, task };
}

test("a converted open saves after the replacement completes", async () => {
  const { loader, events } = harness(true);
  await loader.openPath("C:/charts/old.json");
  assert.deepEqual(events, ["replacement:start", "resources", "replacement:end", "commit"]);
});

test("a converted library candidate saves after the replacement completes", async () => {
  const { loader, events } = harness(true);
  await loader.loadCandidate({ chart: { META: { name: "old" } }, name: "old.json" }, new Map());
  assert.deepEqual(events, ["replacement:start", "resources", "replacement:end", "commit"]);
});

test("an ordinary open does not trigger an extra save", async () => {
  const { loader, events } = harness(false);
  await loader.openPath("C:/charts/old.json");
  assert.deepEqual(events, ["replacement:start", "resources", "replacement:end"]);
});

test("a rejected replacement rethrows the original error for callers", async () => {
  const failure = Object.assign(new Error("No RPE chart found in the PEZ archive."), {
    code: "pez_chart_missing",
    solution: "…",
    documentError: true,
  });
  const loader = createQueuedCandidateLoader({
    coordinator: {
      async submitReplacement() {
        return { status: "rejected", reason: "failed", message: failure.message, error: failure };
      },
    },
    openDocument: async () => {
      throw new Error("the native open must not run for a rejected replacement");
    },
    loadCandidateResources: async () => undefined,
    currentChartFingerprint: () => "fingerprint",
    currentDiskSnapshot: () => null,
    currentChartName: () => "old.json",
    currentPath: () => null,
    currentChart: () => ({ chart: true }),
  });
  await assert.rejects(loader.openPath("C:/charts/chart-less.zip"), (error) => error === failure);
});
