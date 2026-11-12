/** Interaction diagnostics retain semantic actions and redacted issues only. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  interactionDiagnosticsSnapshot,
  recordDiagnosticAction,
  recordDiagnosticIssue,
  resetInteractionDiagnostics,
} from "../../core/diagnostics/interactionLog.ts";

test("actions omit input values and issues redact sensitive text", () => {
  resetInteractionDiagnostics();
  recordDiagnosticAction("document.save", "shortcut", "completed", "editor");
  recordDiagnosticAction("edit.paste", "toolbar", "completed");
  recordDiagnosticIssue(
    "error",
    "frontend",
    "failed path=C:\\Users\\Alice\\chart.json token=SECRET alice@example.com",
    "editor.feedback",
  );

  const snapshot = interactionDiagnosticsSnapshot();
  assert.equal(snapshot.actions.length, 2);
  assert.deepEqual(snapshot.actions[0], {
    at: snapshot.actions[0].at,
    id: "document.save",
    source: "shortcut",
    outcome: "completed",
    surface: "editor",
  });
  assert.deepEqual(snapshot.actions[1], {
    at: snapshot.actions[1].at,
    id: "edit.paste",
    source: "toolbar",
    outcome: "completed",
  });
  assert.equal(snapshot.issues.length, 1);
  assert.equal(snapshot.issues[0].code, "editor.feedback");
  assert.ok(!snapshot.issues[0].message.includes("Alice"));
  assert.ok(!snapshot.issues[0].message.includes("SECRET"));
  assert.ok(!snapshot.issues[0].message.includes("alice@example.com"));
});
