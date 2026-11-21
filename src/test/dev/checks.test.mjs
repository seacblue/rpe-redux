/** Developer boundary checks produce stable finding kinds and messages. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  devCheckFinite,
  devCheckIndex,
  devCheckOneOf,
  devCheckRange,
  devInspectResult,
  devReportError,
} from "../../core/dev/checks.ts";
import { clearDevFindings, getDevFindings, setDevCaptureEnabled } from "../../core/dev/detector.ts";

function withDetector(run) {
  setDevCaptureEnabled(true);
  clearDevFindings();
  try {
    run();
  } finally {
    setDevCaptureEnabled(false);
    clearDevFindings();
  }
}

test("range checks pass valid values and report invalid ones", () => {
  withDetector(() => {
    assert.equal(devCheckRange("chart.read.limit", 10, 1, 100), true);
    assert.equal(devCheckRange("chart.read.limit", 0, 1, 100), false);
    assert.equal(devCheckRange("chart.read.limit", 1.5, 1, 100, { integer: true }), false);
    const findings = getDevFindings();
    assert.equal(findings.length, 2);
    assert.equal(findings[0].kind, "out-of-range");
    assert.match(findings[0].message, /\[1, 100\]/u);
  });
});

test("index, one-of, and finite helpers report their own categories", () => {
  withDetector(() => {
    assert.equal(devCheckIndex("chart.line.index", 0, 3), true);
    assert.equal(devCheckIndex("chart.line.index", 3, 3), false);
    assert.equal(devCheckOneOf("selection.mode", "add", ["replace", "add"]), true);
    assert.equal(devCheckOneOf("selection.mode", "append", ["replace", "add"]), false);
    assert.equal(devCheckFinite("playback.rate", Number.NaN), false);
    const kinds = getDevFindings().map((finding) => finding.kind);
    assert.deepEqual(kinds, ["out-of-range", "invalid", "out-of-range"]);
  });
});

test("caught RangeErrors map to out-of-range findings", () => {
  withDetector(() => {
    devReportError("playback.setRate", new RangeError("rate must be in (0, 16]"));
    const [finding] = getDevFindings();
    assert.equal(finding.kind, "out-of-range");
    assert.match(finding.message, /rate must be/u);
  });
});

test("result inspection reports invalid requests and transaction issues", () => {
  withDetector(() => {
    devInspectResult("chart.read", {
      ok: false,
      error: { code: "invalid_request", message: "limit must be positive" },
    });
    devInspectResult("transaction.apply", {
      ok: true,
      value: {
        status: "rejected",
        issues: [
          { code: "note_out_of_range", message: "positionX is outside the line", path: "notes[0]" },
        ],
      },
    });
    const findings = getDevFindings();
    assert.deepEqual(
      findings.map((finding) => finding.kind),
      ["invalid", "error"],
    );
    assert.match(findings[1].message, /note_out_of_range/u);
    assert.equal(findings[1].detail, "path: notes[0]");
  });
});
