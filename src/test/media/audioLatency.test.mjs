/** Verify the visual clock subtracts both stages of the output chain. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  latencyReport,
  startDrainProgress,
  totalOutputLatency,
} from "../../core/media/outputLatency.ts";

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

test("the start drain progresses over the output chain", () => {
  // The source starts at the processing clock; the speaker hears it after the
  // graph and device stages. The visual clock uses this progress to establish the
  // display lead only as the sound becomes audible.
  const source = { baseLatency: 0.01, outputLatency: 0.04, currentTime: 9.99 };

  assert.ok(Math.abs(startDrainProgress(source, 9.965) - 0.5) < 1e-12);
  assert.equal(startDrainProgress({ ...source, currentTime: 9.95 }, 9.965), 0);
  assert.equal(startDrainProgress({ ...source, currentTime: 10.02 }, 9.965), 1);
});

test("a start without latency has no drain", () => {
  assert.equal(startDrainProgress({ currentTime: 10 }, 9), 1);
});

test("an unusable clock or anchor reports a completed drain", () => {
  assert.equal(startDrainProgress({ baseLatency: 0.01, currentTime: Number.NaN }, 9), 1);
  assert.equal(startDrainProgress({ baseLatency: 0.01, currentTime: 10 }, Number.NaN), 1);
});
