/**
 * Pins the startup failure screen's pure decisions: which explanation category
 * wins, which Extension evidence block is shown, and how a long failure line is
 * shortened. Component rendering is covered by the desktop verification suite.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyStartupFailure,
  STARTUP_EXTENSION_CANDIDATE_LIMIT,
  STARTUP_FAILURE_MESSAGE_LIMIT,
  startupExtensionCandidates,
  startupFailureMessage,
} from "../../../frontend/screens/startup/startupDiagnostics.ts";

const failure = (id, message = "boom") => ({
  id,
  name: `Name ${id}`,
  version: "1.0.0",
  message,
});

const activation = (id) => ({
  id,
  name: `Name ${id}`,
  version: "1.0.0",
});

test("the four failure categories map from their origins", () => {
  assert.equal(classifyStartupFailure("render", []), "render");
  assert.equal(classifyStartupFailure("editor", []), "render");
  assert.equal(classifyStartupFailure("backend", []), "backend");
  assert.equal(classifyStartupFailure("unknown", []), "unknown");
});

test("a recorded Extension failure wins over the reported origin", () => {
  assert.equal(classifyStartupFailure("backend", [failure("ext.one")]), "extension");
  assert.equal(classifyStartupFailure("unknown", [failure("ext.one")]), "extension");
});

test("explicit failures are preferred over loaded candidates", () => {
  const failures = [failure("ext.one"), failure("ext.two")];
  const candidates = startupExtensionCandidates(failures, [activation("ext.three")]);
  assert.equal(candidates.kind, "failures");
  assert.deepEqual(candidates.items, failures);
  assert.equal(candidates.total, 2);
});

test("loaded candidates are capped and report the omitted count", () => {
  const activations = Array.from({ length: STARTUP_EXTENSION_CANDIDATE_LIMIT + 3 }, (_, index) =>
    activation(`ext.${index}`),
  );
  const candidates = startupExtensionCandidates([], activations);
  assert.equal(candidates.kind, "activations");
  assert.equal(candidates.items.length, STARTUP_EXTENSION_CANDIDATE_LIMIT);
  assert.equal(candidates.total, activations.length);
  assert.equal(candidates.total - candidates.items.length, 3);
});

test("no evidence yields an explicit empty state", () => {
  const candidates = startupExtensionCandidates([], []);
  assert.equal(candidates.kind, "none");
  assert.equal(candidates.items.length, 0);
  assert.equal(candidates.total, 0);
});

test("a failure line keeps its first line and a bounded length", () => {
  assert.equal(startupFailureMessage("first line\nsecond line"), "first line");
  const long = "x".repeat(STARTUP_FAILURE_MESSAGE_LIMIT + 20);
  const shortened = startupFailureMessage(long);
  assert.equal(shortened.length, STARTUP_FAILURE_MESSAGE_LIMIT);
  assert.ok(shortened.endsWith("…"));
  assert.equal(startupFailureMessage("  spaced  "), "spaced");
});
