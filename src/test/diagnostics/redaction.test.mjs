/** Shared diagnostics redaction keeps generic messages safe as well as keyed values. */
import assert from "node:assert/strict";
import test from "node:test";
import { redactDiagnosticText, redactDiagnosticValue } from "../../core/diagnostics/redaction.ts";

test("redacts embedded paths, emails, and generic secret assignments", () => {
  const value = redactDiagnosticText(
    "path=C:\\Users\\Alice\\chart.json user=alice@example.com token=SECRET",
  );
  assert.equal(value, "path=[redacted] user=[redacted] token[redacted]");
});

test("redacts sensitive keys recursively while keeping safe counters", () => {
  assert.deepEqual(
    redactDiagnosticValue({
      count: 3,
      path: "C:\\Users\\Alice\\chart.json",
      nested: { message: "user=alice@example.com" },
    }),
    {
      count: 3,
      path: "[redacted]",
      nested: { message: "user=[redacted]" },
    },
  );
});
