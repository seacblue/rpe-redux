/** Verify the visual clock subtracts both stages of the output chain. */
import assert from "node:assert/strict";
import test from "node:test";
import { latencyReport, totalOutputLatency } from "../../core/media/outputLatency.ts";

test("output latency sums the graph and device stages", () => {
  // The reference device reports 10.0 ms in the graph plus 40.0 ms in the
  // device buffer. Only summing them matches the ~53 ms measured between the
  // processing clock and the audio the device had actually emitted.
  assert.ok(
    Math.abs(totalOutputLatency({ baseLatency: 0.01, outputLatency: 0.04 }) - 0.05) < 1e-12,
  );
});

test("output latency keeps whichever stage a host reports", () => {
  assert.equal(totalOutputLatency({ baseLatency: 0.02 }), 0.02);
  assert.equal(totalOutputLatency({ outputLatency: 0.03 }), 0.03);
  assert.equal(totalOutputLatency({}), 0);
});

test("output latency ignores unusable stages instead of yielding NaN", () => {
  assert.equal(totalOutputLatency({ baseLatency: Number.NaN, outputLatency: 0.04 }), 0.04);
  assert.equal(totalOutputLatency({ baseLatency: 0.01, outputLatency: Infinity }), 0.01);
  assert.equal(totalOutputLatency({ baseLatency: -0.5, outputLatency: 0.04 }), 0.04);
});

test("output latency stays inside the accepted range", () => {
  assert.equal(totalOutputLatency({ baseLatency: 5, outputLatency: 5 }), 0.5);
});

test("latency report measures the queue the device has not played yet", () => {
  // The processing clock is at 10 s while the device has emitted up to 9.9464 s,
  // so 53.6 ms of samples are already queued. That queue is why a stop cannot be
  // instant: the gain has to be pulled down as well as the source.
  const report = latencyReport({
    baseLatency: 0.01,
    outputLatency: 0.04,
    currentTime: 10,
    getOutputTimestamp: () => ({ contextTime: 9.9464 }),
  });
  assert.ok(Math.abs(report.outputLatency - 0.05) < 1e-12);
  assert.ok(Math.abs(report.drainedSeconds - 0.0536) < 1e-12);
});

test("latency report treats a missing device timestamp as unknown", () => {
  const absent = latencyReport({ baseLatency: 0.01, currentTime: 5 });
  assert.equal(absent.drainedSeconds, null);

  const unused = latencyReport({
    baseLatency: 0.01,
    currentTime: 5,
    getOutputTimestamp: () => ({ contextTime: 0 }),
  });
  assert.equal(unused.drainedSeconds, null, "a zero timestamp means nothing was emitted yet");

  const throwing = latencyReport({
    baseLatency: 0.01,
    currentTime: 5,
    getOutputTimestamp: () => {
      throw new Error("unsupported");
    },
  });
  assert.equal(throwing.drainedSeconds, null);
});
