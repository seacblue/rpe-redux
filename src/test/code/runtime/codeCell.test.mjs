/**
 * Code-cell runtime behaviour: the wrapper, the write capability profile,
 * the one-shot lifecycle, revision pins, and source-adjusted errors.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { redux } from "../../../core/api/index.ts";
import {
  adjustCodeCellError,
  buildCodeCellSource,
  CodeCellRuntime,
} from "../../../core/codecell/runtime.ts";
import { createChart } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { connectTransactionApi } from "../../../core/edit/transaction/service.ts";
import {
  PREFERENCE_SECTIONS,
  readPreference,
  writePreference,
} from "../../../core/state/preferences.ts";

const revisions = Object.freeze({
  chartFingerprint: "fp",
  diskSnapshot: null,
  generation: 1,
});

function factoryFor(outcome, capture) {
  return (input) => {
    capture.input = input;
    return {
      start: async () => {},
      runCell: async () => outcome,
      dispose: () => {
        capture.disposed = true;
      },
    };
  };
}

function runtimeFor(factory, overrides = {}) {
  return new CodeCellRuntime({
    sandboxFactory: factory,
    api: () => redux,
    enabled: () => true,
    revisions: () => revisions,
    reportFailure: () => {},
    ...overrides,
  });
}

test("a cell runs in the shared sandbox with the write profile", async () => {
  const capture = {};
  const runtime = runtimeFor(
    factoryFor(
      {
        ok: true,
        value: { answer: 42 },
        logs: [{ level: "log", text: "hello", atMs: 1 }],
        durationMs: 3,
        truncated: false,
      },
      capture,
    ),
  );
  const result = await runtime.run({ source: "return 42;", args: { line: 2 } });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { answer: 42 });
  assert.deepEqual(result.startRevisions, revisions);
  assert.deepEqual(result.endRevisions, revisions);
  assert.deepEqual(result.capabilities, [
    "document.read",
    "chart.read",
    "selection.read",
    "preview.read",
    "chart.write",
    "library.read",
    "assets.write",
  ]);
  assert.equal(result.logs[0].text, "hello");
  assert.equal(capture.input.mode, "cell");
  assert.equal(capture.input.timeoutMs, 10_000);
  assert.deepEqual(capture.input.input, { line: 2 });
  assert.match(capture.input.source, /return 42;/);
  assert.match(capture.input.source, /sourceURL=redux-cell-[a-f0-9]+\.js/);
  assert.match(capture.input.manifest.id, /^cell\./);
  assert.deepEqual(capture.input.manifest.capabilities, result.capabilities);
  assert.equal(capture.disposed, true);
  assert.match(result.id, /^[a-f0-9]+$/);
});

test("the cell host exposes chart writes but denies document writes and UI surfaces", async () => {
  const capture = {};
  const runtime = runtimeFor(
    factoryFor({ ok: true, value: null, logs: [], durationMs: 0, truncated: false }, capture),
  );
  await runtime.run({ source: "return null;" });

  const api = capture.input.context.api;
  assert.equal(typeof api.document.state, "function");
  assert.equal(typeof api.chart.snapshot, "function");
  assert.throws(() => api.document.save(), /document\.write|capability/i);
  assert.throws(() => api.document.openPath("x"), /document\.write|capability/i);
  assert.equal(typeof api.transaction.apply, "function");
  assert.equal(typeof api.library.addAsset, "function");
  assert.throws(() => api.library.remove("x"), /library\.write|capability/i);
  assert.throws(() => capture.input.context.ui.notice("x"), /do not expose ui\.notice/);
  assert.throws(() => capture.input.context.settings.get("x"), /do not expose settings/);
  assert.equal(capture.input.manifest.capabilities.includes("chart.write"), true);
});

test("the read profile runs and denies the transaction handle lazily", async () => {
  const capture = {};
  let capabilitiesValue;
  let transactionError;
  let placeNoteError;
  const runtime = runtimeFor((input) => {
    capture.input = input;
    return {
      start: async () => {},
      runCell: async () => {
        capabilitiesValue = input.context.api.capabilities();
        try {
          input.context.api.transaction;
        } catch (error) {
          transactionError = error;
        }
        try {
          input.context.api.chart.placeNote(1, {});
        } catch (error) {
          placeNoteError = error;
        }
        return { ok: true, value: { read: true }, logs: [], durationMs: 1, truncated: false };
      },
      dispose: () => {},
    };
  });
  const result = await runtime.run({ source: "return 1;", profile: "read" });

  assert.equal(result.ok, true);
  assert.deepEqual(result.capabilities, [
    "document.read",
    "chart.read",
    "selection.read",
    "preview.read",
  ]);
  assert.deepEqual(capabilitiesValue, result.capabilities);
  assert.deepEqual(capture.input.manifest.capabilities, result.capabilities);
  assert.equal(transactionError?.code, "capabilityDenied");
  assert.equal(transactionError?.capability, "chart.write");
  assert.equal(placeNoteError?.code, "capabilityDenied");
  assert.equal(placeNoteError?.capability, "chart.write");
});

test("the write profile withholds direct note placement and history undo/redo", async () => {
  let placeNoteError;
  let undoError;
  let redoError;
  const runtime = runtimeFor((input) => ({
    start: async () => {},
    runCell: async () => {
      const api = input.context.api;
      try {
        api.chart.placeNote(1, {});
      } catch (error) {
        placeNoteError = error;
      }
      try {
        api.transaction.undo;
      } catch (error) {
        undoError = error;
      }
      try {
        api.transaction.redo;
      } catch (error) {
        redoError = error;
      }
      return {
        ok: true,
        value: typeof api.transaction.apply === "function" && typeof api.transaction.history,
        logs: [],
        durationMs: 1,
        truncated: false,
      };
    },
    dispose: () => {},
  }));
  const result = await runtime.run({ source: "return 1;" });

  assert.equal(result.ok, true);
  assert.equal(result.value, "function");
  assert.equal(placeNoteError?.code, "capabilityDenied");
  assert.equal(placeNoteError?.capability, "chart.write");
  assert.equal(undoError?.code, "capabilityDenied");
  assert.equal(undoError?.capability, "chart.write");
  assert.equal(redoError?.code, "capabilityDenied");
  assert.equal(redoError?.capability, "chart.write");
});

test("a cell write is rejected after the user edits the same document", async () => {
  const session = new EditorSession(createChart());
  const disconnect = connectTransactionApi({ session: () => session });
  try {
    let applied;
    const runtime = runtimeFor(
      (input) => ({
        start: async () => {},
        runCell: async () => {
          session.commitChart("user edit", {
            ...session.chart,
            META: { ...session.chart.META, name: "user edit" },
          });
          applied = input.context.api.transaction.apply({
            label: "cell edit",
            metadata: { name: "cell edit" },
          });
          return { ok: true, value: applied, logs: [], durationMs: 1, truncated: false };
        },
        dispose: () => {},
      }),
      {
        revisions: () => ({
          chartFingerprint: session.history.fingerprint(),
          diskSnapshot: "disk-1",
          generation: 1,
        }),
      },
    );
    const result = await runtime.run({ source: "return 1;" });

    assert.equal(result.ok, true);
    assert.equal(result.value.ok, true);
    assert.equal(result.value.value.status, "rejected");
    assert.equal(result.value.value.issues[0].code, "stale_read");
    assert.match(result.value.value.issues[0].message, /chartFingerprint/);
    assert.equal(session.chart.META.name, "user edit");
    assert.equal(session.history.undoStack.length, 1);
  } finally {
    disconnect();
  }
});

test("a cell write is rejected after the editor switches documents", async () => {
  const first = new EditorSession(createChart());
  const second = new EditorSession(createChart());
  let current = first;
  const disconnect = connectTransactionApi({ session: () => current });
  try {
    let applied;
    const runtime = runtimeFor(
      (input) => ({
        start: async () => {},
        runCell: async () => {
          current = second;
          applied = input.context.api.transaction.apply({
            label: "cell edit",
            metadata: { name: "cell edit" },
          });
          return { ok: true, value: applied, logs: [], durationMs: 1, truncated: false };
        },
        dispose: () => {},
      }),
      {
        revisions: () => ({
          chartFingerprint: current.history.fingerprint(),
          diskSnapshot: current === first ? "disk-1" : "disk-2",
          generation: current === first ? 1 : 2,
        }),
      },
    );
    const result = await runtime.run({ source: "return 1;" });

    assert.equal(result.ok, true);
    assert.equal(result.value.value.status, "rejected");
    assert.equal(result.value.value.issues[0].code, "stale_read");
    assert.equal(second.history.undoStack.length, 0);
    assert.equal(second.chart.META.name, first.chart.META.name);
  } finally {
    disconnect();
  }
});

test("a cell write is rejected after the disk snapshot changes", async () => {
  const session = new EditorSession(createChart());
  let diskSnapshot = "disk-1";
  const disconnect = connectTransactionApi({ session: () => session });
  try {
    let applied;
    const runtime = runtimeFor(
      (input) => ({
        start: async () => {},
        runCell: async () => {
          diskSnapshot = "disk-2";
          applied = input.context.api.transaction.apply({
            label: "cell edit",
            metadata: { name: "cell edit" },
          });
          return { ok: true, value: applied, logs: [], durationMs: 1, truncated: false };
        },
        dispose: () => {},
      }),
      {
        revisions: () => ({
          chartFingerprint: session.history.fingerprint(),
          diskSnapshot,
          generation: 1,
        }),
      },
    );
    const result = await runtime.run({ source: "return 1;" });

    assert.equal(result.ok, true);
    assert.equal(result.value.value.status, "rejected");
    assert.equal(result.value.value.issues[0].code, "stale_read");
    assert.match(result.value.value.issues[0].message, /diskSnapshot/);
    assert.equal(session.history.undoStack.length, 0);
  } finally {
    disconnect();
  }
});

test("preview and apply both reject a stale write and retire the old preview", async () => {
  const session = new EditorSession(createChart());
  const disconnect = connectTransactionApi({ session: () => session });
  try {
    let preview;
    let staleApply;
    let stalePreview;
    const runtime = runtimeFor(
      (input) => ({
        start: async () => {},
        runCell: async () => {
          preview = input.context.api.transaction.preview({
            label: "cell preview",
            metadata: { name: "cell preview" },
          });
          session.commitChart("user edit", {
            ...session.chart,
            META: { ...session.chart.META, name: "user edit" },
          });
          staleApply = input.context.api.transaction.apply(preview.value.previewId);
          stalePreview = input.context.api.transaction.preview({
            label: "second preview",
            metadata: { name: "second preview" },
          });
          return {
            ok: true,
            value: { preview, staleApply, stalePreview },
            logs: [],
            durationMs: 1,
            truncated: false,
          };
        },
        dispose: () => {},
      }),
      {
        revisions: () => ({
          chartFingerprint: session.history.fingerprint(),
          diskSnapshot: "disk-1",
          generation: 1,
        }),
      },
    );
    const result = await runtime.run({ source: "return 1;" });

    assert.equal(result.ok, true);
    assert.equal(result.value.preview.value.status, "previewed");
    assert.ok(result.value.preview.value.previewId);
    assert.equal(result.value.staleApply.value.status, "rejected");
    assert.equal(result.value.staleApply.value.issues[0].code, "stale_read");
    assert.equal(result.value.stalePreview.value.status, "rejected");
    assert.equal(result.value.stalePreview.value.issues[0].code, "stale_read");
    assert.equal(result.value.stalePreview.value.previewId, null);
    assert.equal(session.chart.META.name, "user edit");
    assert.equal(session.history.undoStack.length, 1);
  } finally {
    disconnect();
  }
});

test("a write cell stamps its run id on the committed history entry", async () => {
  const session = new EditorSession(createChart());
  const disconnect = connectTransactionApi({ session: () => session });
  try {
    const runtime = runtimeFor((input) => ({
      start: async () => {},
      runCell: async () => {
        const applied = input.context.api.transaction.apply({
          label: "cell edit",
          metadata: { name: "cell edit" },
        });
        return { ok: true, value: applied, logs: [], durationMs: 1, truncated: false };
      },
      dispose: () => {},
    }));
    const result = await runtime.run({ source: "return 1;" });
    const expected = { kind: "code-cell", requestId: result.id };

    assert.equal(result.ok, true);
    assert.equal(result.value.ok, true);
    assert.equal(result.value.value.status, "committed");
    assert.deepEqual(result.value.value.history.origin, expected);
    assert.deepEqual(session.history.undoStack.at(-1).origin, expected);
  } finally {
    disconnect();
  }
});

test("a previewed cell transaction keeps its origin when applied by id", async () => {
  const session = new EditorSession(createChart());
  const disconnect = connectTransactionApi({ session: () => session });
  try {
    const runtime = runtimeFor((input) => ({
      start: async () => {},
      runCell: async () => {
        const preview = input.context.api.transaction.preview({
          label: "previewed cell edit",
          metadata: { name: "previewed cell edit" },
        });
        const applied = input.context.api.transaction.apply(preview.value.previewId);
        return { ok: true, value: applied, logs: [], durationMs: 1, truncated: false };
      },
      dispose: () => {},
    }));
    const result = await runtime.run({ source: "return 1;" });
    const expected = { kind: "code-cell", requestId: result.id };

    assert.equal(result.ok, true);
    assert.equal(result.value.value.status, "committed");
    assert.deepEqual(result.value.value.history.origin, expected);
    assert.deepEqual(session.history.undoStack.at(-1).origin, expected);
  } finally {
    disconnect();
  }
});

test("finishing a cell cancels previews the cell did not consume", async () => {
  const cancelled = [];
  const transaction = {
    availability: () => ({ available: true }),
    preview: () => ({
      ok: true,
      value: {
        status: "previewed",
        affectedObjectIds: [],
        issues: [],
        previewId: "preview-1",
      },
    }),
    apply: () => {
      throw new Error("apply must not run");
    },
    cancel: (previewId) => {
      cancelled.push(previewId);
      return { ok: true, value: true };
    },
    history: () => ({ ok: true, value: { canUndo: false, canRedo: false } }),
    undo: () => ({}),
    redo: () => ({}),
  };
  const api = { ...redux, transaction };
  const runtime = runtimeFor(
    (input) => ({
      start: async () => {},
      runCell: async () => ({
        ok: true,
        value: input.context.api.transaction.preview({ metadata: { name: "pending" } }),
        logs: [],
        durationMs: 1,
        truncated: false,
      }),
      dispose: () => {},
    }),
    { api: () => api },
  );
  const result = await runtime.run({ source: "return 1;" });

  assert.equal(result.ok, true);
  assert.deepEqual(cancelled, ["preview-1"]);
});

test("disabled, stale, oversized, and failed cells return structured errors", async () => {
  const capture = {};
  const disabled = runtimeFor(factoryFor(null, capture), { enabled: () => false });
  assert.equal((await disabled.run({ source: "return 1;" })).error.code, "disabled");
  assert.equal(capture.input, undefined);

  const runtime = runtimeFor(
    factoryFor(
      {
        ok: false,
        logs: [],
        error: {
          name: "Error",
          message: "boom",
          stack: "Error: boom\n    at run (redux-cell-abc.js:4:7)",
        },
        durationMs: 2,
        truncated: false,
      },
      capture,
    ),
  );
  const stale = await runtime.run({
    source: "return 1;",
    expected: { chartFingerprint: "other" },
  });
  assert.equal(stale.error.code, "stale_read");
  assert.match(stale.error.message, /chartFingerprint/);
  assert.equal(stale.capabilities.length, 7);

  const oversized = await runtime.run({ source: "x".repeat(100_001) });
  assert.equal(oversized.error.code, "invalid_request");

  const failed = await runtime.run({ source: "throw new Error('boom');" });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "exception");
  assert.equal(failed.error.line, 3);
  assert.equal(failed.error.column, 7);
  assert.match(failed.error.stack, /redux-cell\.js:3:7/);
});

test("timeouts and cancellations have their own error classes", async () => {
  const runtime = runtimeFor(
    factoryFor(
      {
        ok: false,
        logs: [],
        error: { name: "TimeoutError", message: "Code cell timed out" },
        durationMs: 10_000,
        truncated: true,
      },
      {},
    ),
  );
  const timeout = await runtime.run({ source: "while (true) {}" });
  assert.equal(timeout.error.code, "timeout");
  assert.equal(timeout.truncated, true);

  const cancelled = await runtimeFor(
    factoryFor(
      {
        ok: false,
        logs: [],
        error: { name: "AbortError", message: "Code cell was disposed" },
        durationMs: 1,
        truncated: false,
      },
      {},
    ),
  ).run({ source: "return 1;" });
  assert.equal(cancelled.error.code, "cancelled");
});

test("only one cell may run at a time", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const runtime = runtimeFor((input) => ({
    start: async () => {},
    runCell: () =>
      gate.then(() => ({
        ok: true,
        value: input.input,
        logs: [],
        durationMs: 1,
        truncated: false,
      })),
    dispose: () => {},
  }));
  const first = runtime.run({ source: "return 1;", args: { first: true } });
  const second = await runtime.run({ source: "return 2;", args: { second: true } });
  assert.equal(second.error.code, "busy");
  release();
  const result = await first;
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { first: true });
});

test("a throwing running-state listener cannot strand the cell in busy", async () => {
  const runtime = runtimeFor(
    factoryFor({ ok: true, value: null, logs: [], durationMs: 0, truncated: false }, {}),
  );
  const unsubscribe = runtime.subscribe(() => {
    throw new Error("observer failed");
  });
  try {
    const first = await runtime.run({ source: "return 1;" });
    assert.equal(first.ok, true);
    assert.equal(runtime.isRunning(), false);

    const second = await runtime.run({ source: "return 2;" });
    assert.equal(second.ok, true);
  } finally {
    unsubscribe();
  }
});

test("cancelling a pending sandbox handshake resolves and releases the busy state", async () => {
  let rejectStart = null;
  let attempts = 0;
  const runtime = runtimeFor(() => {
    attempts += 1;
    if (attempts === 1) {
      return {
        start: () =>
          new Promise((_resolve, reject) => {
            rejectStart = reject;
          }),
        runCell: () => new Promise(() => {}),
        dispose: () => {
          const error = new Error("Code cell sandbox was disposed");
          error.name = "AbortError";
          rejectStart?.(error);
        },
      };
    }
    return {
      start: async () => {},
      runCell: async () => ({
        ok: true,
        value: attempts,
        logs: [],
        durationMs: 1,
        truncated: false,
      }),
      dispose: () => {},
    };
  });
  const pending = runtime.run({ source: "return 1;" });
  runtime.cancel();
  let timeout;
  try {
    const result = await Promise.race([
      pending,
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("cancel did not release the cell")), 1_000);
      }),
    ]);
    assert.equal(result.error.code, "cancelled");
    assert.equal(runtime.isRunning(), false);

    const next = await runtime.run({ source: "return 2;" });
    assert.equal(next.ok, true);
    assert.equal(next.value, 2);
  } finally {
    clearTimeout(timeout);
  }
});

test("a sandbox handshake timeout returns a timeout and releases the busy state", async () => {
  let attempts = 0;
  const runtime = runtimeFor(() => {
    attempts += 1;
    if (attempts === 1) {
      return {
        start: async () => {
          const error = new Error("Extension sandbox did not become ready");
          error.name = "TimeoutError";
          throw error;
        },
        runCell: () => new Promise(() => {}),
        dispose: () => {},
      };
    }
    return {
      start: async () => {},
      runCell: async () => ({ ok: true, value: "next", logs: [], durationMs: 1, truncated: false }),
      dispose: () => {},
    };
  });

  const result = await runtime.run({ source: "return 1;" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "timeout");
  assert.equal(runtime.isRunning(), false);

  const next = await runtime.run({ source: "return 2;" });
  assert.equal(next.ok, true);
  assert.equal(next.value, "next");
});

test("the console can observe and cancel a running cell", async () => {
  let resolveRun;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const runtime = runtimeFor(() => ({
    start: async () => {},
    runCell: () => {
      markStarted();
      return new Promise((resolve) => {
        resolveRun = resolve;
      });
    },
    dispose: () => {
      resolveRun?.({
        ok: false,
        logs: [],
        error: { name: "AbortError", message: "Code cell was disposed" },
        durationMs: 1,
        truncated: false,
      });
    },
  }));
  let notifications = 0;
  const unsubscribe = runtime.subscribe(() => {
    notifications += 1;
  });
  const pending = runtime.run({ source: "return 1;", timeoutMs: 5_000 });
  await started;
  assert.equal(runtime.isRunning(), true);
  runtime.cancel();
  const cancelled = await pending;
  assert.equal(cancelled.error.code, "cancelled");
  assert.equal(runtime.isRunning(), false);
  assert.ok(notifications >= 2);
  unsubscribe();
});

test("the cell facade rejects a transaction field the user restricted for AI", async () => {
  const section = PREFERENCE_SECTIONS.settings;
  const previous = readPreference(section, {});
  writePreference(section, {
    "code-execution-enabled": true,
    "editing-note-speed-ai-enabled": false,
  });
  try {
    const runtime = runtimeFor((input) => ({
      start: async () => {},
      runCell: async () => {
        const applied = input.context.api.transaction.apply({
          notes: {
            insert: [
              {
                lineId: "line-1",
                note: {
                  type: 1,
                  startTime: [0, 0, 1],
                  endTime: [0, 0, 1],
                  positionX: 0,
                  speed: 2,
                },
              },
            ],
          },
        });
        return { ok: true, value: applied, logs: [], durationMs: 1, truncated: false };
      },
      dispose: () => {},
    }));
    const result = await runtime.run({ source: "return 1;" });
    assert.equal(result.ok, true);
    assert.equal(result.value.ok, true);
    assert.equal(result.value.value.status, "rejected");
    assert.equal(result.value.value.issues[0].code, "ai.feature.restricted");
    assert.equal(result.value.value.issues[0].path, "notes.insert[0].note.speed");
  } finally {
    writePreference(section, previous);
  }
});

test("the wrapper keeps submitted source on line two and shifts stacks back", () => {
  const source = buildCodeCellSource("return 1;", "cell-1");
  assert.match(source, /^const run = async \(redux, input\) => \{\nreturn 1;\n\};/);
  assert.match(source, /sourceURL=redux-cell-cell-1\.js$/);

  const adjusted = adjustCodeCellError({
    name: "SyntaxError",
    message: "Unexpected token",
    stack: "SyntaxError: Unexpected token\n    at run (redux-cell-x.js:2:9)",
  });
  assert.equal(adjusted.code, "syntax");
  assert.equal(adjusted.line, 1);
  assert.equal(adjusted.column, 9);
  assert.match(adjusted.stack, /redux-cell\.js:1:9/);
});
