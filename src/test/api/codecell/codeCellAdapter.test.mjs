/** Code Cell bridge adapter validation, revision pinning, and runtime forwarding. */
import assert from "node:assert/strict";
import test from "node:test";
import { createCodeCellAdapter } from "../../../core/edit/codecell/adapter.ts";
import { connectCodeCellGuide } from "../../../core/edit/codecell/guide.ts";

const revisions = Object.freeze({
  chartFingerprint: "chart-1",
  diskSnapshot: "disk-1",
  generation: 1,
});

const state = () => ({ revisions });

function result(overrides = {}) {
  return {
    ok: true,
    value: 1,
    logs: [],
    durationMs: 1,
    startRevisions: revisions,
    endRevisions: revisions,
    capabilities: [],
    truncated: false,
    ...overrides,
  };
}

test("cell.guide returns the bound Code Cell guide", async () => {
  const dispose = connectCodeCellGuide("# code-cell-guide");
  try {
    const adapter = createCodeCellAdapter({ state });
    const response = await adapter.handle({ method: "cell.guide" });
    assert.deepEqual(response.value, { text: "# code-cell-guide" });
  } finally {
    dispose();
  }
});

test("cell.run forwards the explicit profile and input to the runtime", async () => {
  let request;
  const adapter = createCodeCellAdapter({
    state,
    code: {
      run: async (value) => {
        request = value;
        return result();
      },
    },
  });
  const response = await adapter.handle({
    method: "cell.run",
    params: {
      source: "return input;",
      profile: "read",
      args: { answer: 42 },
      expected: { chartFingerprint: "chart-1" },
      timeoutMs: 1200,
    },
  });
  assert.equal(response.ok, true);
  assert.deepEqual(request, {
    source: "return input;",
    profile: "read",
    args: { answer: 42 },
    expected: { chartFingerprint: "chart-1" },
    timeoutMs: 1200,
  });
});

test("cell.run rejects a stale revision before starting the runtime", async () => {
  let runs = 0;
  const adapter = createCodeCellAdapter({
    state,
    code: {
      run: async () => {
        runs += 1;
        return result();
      },
    },
  });
  const response = await adapter.handle({
    method: "cell.run",
    params: { source: "return 1;", expected: { chartFingerprint: "old" } },
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "stale_read");
  assert.equal(runs, 0);
});

test("retired protocol methods are rejected", async () => {
  const adapter = createCodeCellAdapter({ state });
  const response = await adapter.handle({ method: "tools/list" });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "method_not_allowed");
});
