/** Exercises normalized failure classification and the editor presentation seam. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  failureDedupeKey,
  failurePresentationOwner,
  markFailurePresented,
  normalizeFailure,
} from "../../../core/contracts/failure.ts";
import {
  createFeedbackDedupe,
  resolveEditorFailure,
} from "../../../frontend/screens/editor/workspace/runtime/session/feedbackPolicy.ts";
import { libraryErrorFromResponse } from "../../../core/global/library/http.ts";

test("normalizes backend codes without exposing backend copy as policy", () => {
  const failure = normalizeFailure(
    Object.assign(new Error("the project changed since it was loaded"), {
      name: "LocalLibraryError",
      code: "revision_conflict",
    }),
    { source: "backend", operation: "save", resource: "project:one" },
  );

  assert.deepEqual(failure, {
    source: "backend",
    code: "revision_conflict",
    kind: "conflict",
    retryable: false,
    message: "the project changed since it was loaded",
    operation: "save",
    resource: "project:one",
  });
  assert.equal(failureDedupeKey(failure), "backend:save:revision_conflict:project:one");
});

test("routes storage and conflict failures to one toast surface", () => {
  const storage = resolveEditorFailure({ code: "storage_error", message: "disk full" });
  assert.equal(storage.surface, "toast");
  assert.equal(storage.failure.retryable, false);
  assert.equal(
    resolveEditorFailure({ code: "revision_conflict", message: "changed" }).surface,
    "toast",
  );
  assert.equal(resolveEditorFailure({ code: "transport", message: "offline" }).surface, "toast");
});

test("preserves the source and retry hint supplied by a transport adapter", () => {
  const failure = normalizeFailure(
    Object.assign(new Error("the local database is temporarily unavailable"), {
      name: "LocalLibraryError",
      code: "database_error",
      source: "database",
      retryable: true,
    }),
  );
  assert.equal(failure.source, "database");
  assert.equal(failure.kind, "storage");
  assert.equal(failure.retryable, true);
  assert.equal(resolveEditorFailure(failure).surface, "toast");
});

test("records a progress owner without changing the original error", () => {
  const error = new Error("save failed");
  assert.equal(failurePresentationOwner(error), undefined);
  markFailurePresented(error, "progress");
  assert.equal(failurePresentationOwner(error), "progress");
});

test("decodes the Go failure envelope at the local-library seam", async () => {
  const error = await libraryErrorFromResponse(
    new Response(
      JSON.stringify({
        error: {
          code: "database_error",
          message: "the local database could not complete the request",
          source: "database",
          retryable: false,
        },
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    ),
  );
  assert.equal(error.code, "database_error");
  assert.equal(error.source, "database");
  assert.equal(error.retryable, false);
  assert.equal(error.status, 500);
});

test("suppresses only repeated claims inside the short feedback window", () => {
  let clock = 1000;
  const gate = createFeedbackDedupe(() => clock, 500);
  assert.equal(gate.claim("backend:save:revision_conflict:project:one"), true);
  assert.equal(gate.claim("backend:save:revision_conflict:project:one"), false);
  clock += 501;
  assert.equal(gate.claim("backend:save:revision_conflict:project:one"), true);
});
