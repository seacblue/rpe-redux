/** The developer findings store: gating, deduplication, and bounded retention. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  clearDevFindings,
  getDevFindings,
  isDevCaptureEnabled,
  MAX_DEV_FINDINGS,
  reportDevFinding,
  setDevCaptureEnabled,
  subscribeDevFindings,
} from "../../core/dev/detector.ts";

test("findings are ignored while capture is off", () => {
  setDevCaptureEnabled(false);
  clearDevFindings();
  reportDevFinding({ kind: "error", source: "test", message: "ignored" });
  assert.equal(isDevCaptureEnabled(), false);
  assert.deepEqual(getDevFindings(), []);
});

test("a repeated finding keeps one row and increments its count", () => {
  setDevCaptureEnabled(true);
  clearDevFindings();
  let notifications = 0;
  const dispose = subscribeDevFindings(() => {
    notifications += 1;
  });
  try {
    reportDevFinding({ kind: "deprecated", source: "chart.notes", message: "Use readAll" });
    reportDevFinding({ kind: "deprecated", source: "chart.notes", message: "Use readAll" });
    const findings = getDevFindings();
    assert.equal(findings.length, 1);
    assert.equal(findings[0].count, 2);
    assert.equal(findings[0].kind, "deprecated");
    assert.ok(findings[0].lastAt >= findings[0].firstAt);
    assert.equal(notifications, 2);
  } finally {
    dispose();
    setDevCaptureEnabled(false);
  }
});

test("the buffer keeps only the newest findings", () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  setDevCaptureEnabled(true);
  clearDevFindings();
  try {
    for (let index = 0; index < MAX_DEV_FINDINGS + 10; index += 1) {
      if (index > 0 && index % 20 === 0) {
        now += 1_100;
      }
      reportDevFinding({ kind: "invalid", source: `source-${index}`, message: "row" });
    }
    const findings = getDevFindings();
    assert.equal(findings.length, MAX_DEV_FINDINGS);
    assert.equal(findings[0].source, "source-10");
    assert.equal(findings.at(-1).source, `source-${MAX_DEV_FINDINGS + 9}`);
  } finally {
    Date.now = realNow;
    setDevCaptureEnabled(false);
  }
});

test("clearing removes every row and stops notifications for old rows", () => {
  setDevCaptureEnabled(true);
  clearDevFindings();
  reportDevFinding({ kind: "error", source: "a", message: "b" });
  clearDevFindings();
  assert.deepEqual(getDevFindings(), []);
  setDevCaptureEnabled(false);
});
