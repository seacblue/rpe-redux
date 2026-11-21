/** The frozen facade guard reports deprecations and failures without changing results. */
import assert from "node:assert/strict";
import test from "node:test";
import { guardDevFacade } from "../../core/dev/apiGuard.ts";
import { clearDevFindings, getDevFindings, setDevCaptureEnabled } from "../../core/dev/detector.ts";

function withDetector(run) {
  setDevCaptureEnabled(true);
  clearDevFindings();
  try {
    return run();
  } finally {
    setDevCaptureEnabled(false);
    clearDevFindings();
  }
}

async function withDetectorAsync(run) {
  setDevCaptureEnabled(true);
  clearDevFindings();
  try {
    return await run();
  } finally {
    setDevCaptureEnabled(false);
    clearDevFindings();
  }
}

test("a deprecated chart helper reports the generated guidance", () => {
  const guarded = guardDevFacade({
    chart: {
      notes() {
        return { ok: true, value: [] };
      },
    },
  });
  withDetector(() => {
    assert.deepEqual(guarded.chart.notes(), { ok: true, value: [] });
    const [finding] = getDevFindings();
    assert.equal(finding.kind, "deprecated");
    assert.equal(finding.source, "chart.notes");
    assert.match(finding.message, /readAll/u);
  });
});

test("repeated reads of the same handle stay guarded", () => {
  const guarded = guardDevFacade({
    chart: {
      notes() {
        return { ok: true, value: [] };
      },
    },
  });
  withDetector(() => {
    guarded.chart.notes();
    guarded.chart.notes();
    const [finding] = getDevFindings();
    assert.equal(finding.source, "chart.notes");
    assert.equal(finding.count, 2);
  });
});

test("the guard preserves this binding and reports thrown range errors", () => {
  const guarded = guardDevFacade({
    value: 7,
    read(limit) {
      if (limit <= 0) {
        throw new RangeError(`limit is out of range: ${limit}`);
      }
      return this.value + limit;
    },
  });
  withDetector(() => {
    assert.equal(guarded.read(2), 9);
    assert.throws(() => guarded.read(0), RangeError);
    const [finding] = getDevFindings();
    assert.equal(finding.kind, "out-of-range");
    assert.equal(finding.source, "read");
  });
});

test("async rejections and failed envelopes are reported", async () => {
  const guarded = guardDevFacade({
    fail() {
      return Promise.reject(new Error("bridge exploded"));
    },
    refuse() {
      return Promise.resolve({ ok: false, error: { code: "invalid_request", message: "bad" } });
    },
  });
  await withDetectorAsync(async () => {
    await assert.rejects(guarded.fail(), /bridge exploded/u);
    await guarded.refuse();
    const findings = getDevFindings();
    assert.deepEqual(
      findings.map((finding) => [finding.source, finding.kind]),
      [
        ["fail", "error"],
        ["refuse", "invalid"],
      ],
    );
  });
});

test("the guard rebuilds a frozen facade", () => {
  const frozen = Object.freeze({
    version: "1.0.0",
    chart: Object.freeze({ notes: () => ({ ok: true, value: [] }) }),
  });
  const guarded = guardDevFacade(frozen);
  assert.equal(guarded.version, "1.0.0");
  assert.equal(typeof guarded.chart.notes, "function");
});
