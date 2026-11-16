/**
 * Contract: a sidecar probe that loses the startup race must retry after the
 * cooldown instead of permanently returning the first null result.
 */
import assert from "node:assert/strict";
import test from "node:test";

test("localService retries a failed startup probe after the cooldown", async () => {
  const previousTauri = globalThis.__TAURI_INTERNALS__;
  const previousFetch = globalThis.fetch;
  let attempts = 0;
  Object.defineProperty(globalThis, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  globalThis.fetch = async (input) => {
    attempts += 1;
    if (attempts <= 3 && String(input).endsWith("/api/health")) {
      throw new Error("sidecar is still starting");
    }
    if (!String(input).endsWith("/api/health")) {
      return new Response(JSON.stringify({ error: { code: "test" } }), { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const { localService } =
      await import("../../../core/global/library/service.ts?startup-retry-test");
    assert.equal(await localService({ refresh: true }), null);
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    const recovered = await localService();
    assert.equal(recovered?.health.ok, true);
    assert.ok(attempts >= 4);
  } finally {
    Object.defineProperty(globalThis, "__TAURI_INTERNALS__", {
      configurable: true,
      value: previousTauri,
    });
    globalThis.fetch = previousFetch;
  }
});
