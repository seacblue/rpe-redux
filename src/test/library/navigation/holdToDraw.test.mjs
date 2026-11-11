/** Long-press charge for the daily fortune draw in the welcome panel. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceHoldFill,
  holdFillFraction,
  holdShake,
  HOLD_DRAIN_MS,
  HOLD_DURATION_MS,
  HOLD_SHAKE_OFFSET_PX,
  HOLD_SHAKE_ROTATE_DEG,
  REVEAL_DRAIN_MS,
} from "../../../frontend/screens/welcome/library/holdToDraw.ts";

/** Feed a fixed frame length for `duration` milliseconds and return the charge. */
function run(fill, duration, elapsedPerFrame, holding) {
  let current = fill;
  for (let elapsed = 0; elapsed < duration; elapsed += elapsedPerFrame) {
    current = advanceHoldFill(current, elapsedPerFrame, holding);
  }
  return current;
}

test("a full hold fills the charge to the draw threshold", () => {
  assert.ok(run(0, HOLD_DURATION_MS - 40, 40, true) < 1);
  assert.equal(run(0, HOLD_DURATION_MS, 40, true), 1);
  assert.equal(advanceHoldFill(1, 100, true), 1);
});

test("a short tap stays well below the threshold", () => {
  const tapped = advanceHoldFill(0, 120, true);
  assert.ok(tapped > 0);
  assert.ok(tapped < 0.2);
});

test("releasing drains the charge slower than holding fills it", () => {
  const filled = advanceHoldFill(0, 500, true);
  assert.equal(filled, 0.5);
  const drained = advanceHoldFill(filled, 500, false);
  assert.equal(drained, 0.5 - 500 / HOLD_DRAIN_MS);
  assert.ok(drained > filled - 0.5);
});

test("a released charge drains to zero and never below it", () => {
  assert.equal(run(0.4, HOLD_DRAIN_MS, 20, false), 0);
  assert.equal(advanceHoldFill(0, 100, false), 0);
});

test("a revealed draw clears faster than a released charge", () => {
  const released = advanceHoldFill(1, 200, false);
  const revealed = advanceHoldFill(1, 200, false, REVEAL_DRAIN_MS);
  assert.equal(released, 1 - 200 / HOLD_DRAIN_MS);
  assert.equal(revealed, 1 - 200 / REVEAL_DRAIN_MS);
  assert.ok(revealed < released);
});

test("the charge clamps to the closed zero and one range", () => {
  assert.equal(advanceHoldFill(0.98, 1000, true), 1);
  assert.equal(advanceHoldFill(0.02, 1000, false), 0);
  assert.equal(advanceHoldFill(Number.NaN, 16, true), 0.016);
  assert.equal(advanceHoldFill(7, 16, false), 1 - 16 / HOLD_DRAIN_MS);
});

test("a stalled or invalid frame leaves the charge unchanged", () => {
  assert.equal(advanceHoldFill(0.3, 0, true), 0.3);
  assert.equal(advanceHoldFill(0.3, -16, true), 0.3);
  assert.equal(advanceHoldFill(0.3, Number.NaN, true), 0.3);
  assert.equal(advanceHoldFill(0.3, Number.POSITIVE_INFINITY, true), 0.3);
});

test("the visible fill eases in from an empty to a full body", () => {
  assert.equal(holdFillFraction(0), 0);
  assert.equal(holdFillFraction(1), 1);
  assert.equal(holdFillFraction(0.5), 0.25);
  assert.ok(holdFillFraction(0.3) < 0.3);
});

test("the fill accelerates: later charge gains more height than early ones", () => {
  const early = holdFillFraction(0.2) - holdFillFraction(0.1);
  const middle = holdFillFraction(0.6) - holdFillFraction(0.5);
  const late = holdFillFraction(0.9) - holdFillFraction(0.8);
  assert.ok(early < middle);
  assert.ok(middle < late);
});

test("the fill rises monotonically and clamps out-of-range charges", () => {
  let previous = 0;
  for (let charge = 0; charge <= 1; charge += 0.02) {
    const fraction = holdFillFraction(charge);
    assert.ok(fraction >= previous);
    previous = fraction;
  }
  assert.equal(holdFillFraction(-1), 0);
  assert.equal(holdFillFraction(2), 1);
  assert.equal(holdFillFraction(Number.NaN), 0);
});

/** Peak offset the vibration reaches over four seconds of held charge. */
function shakeEnvelope(fill) {
  let peak = 0;
  for (let elapsed = 0; elapsed <= 4000; elapsed += 3) {
    const shake = holdShake(fill, elapsed);
    peak = Math.max(peak, Math.abs(shake.x), Math.abs(shake.y));
  }
  return peak;
}

test("the charge vibration is still before the press builds", () => {
  for (const shake of [holdShake(0, 0), holdShake(0, 1234), holdShake(Number.NaN, 500)]) {
    assert.equal(Math.abs(shake.x), 0);
    assert.equal(Math.abs(shake.y), 0);
    assert.equal(Math.abs(shake.rotate), 0);
  }
});

test("the charge vibration grows with the press but stays faint", () => {
  assert.ok(shakeEnvelope(0.9) > shakeEnvelope(0.3));
  assert.ok(shakeEnvelope(0.3) > 0);
  assert.ok(shakeEnvelope(1) <= HOLD_SHAKE_OFFSET_PX + 1e-9);
  assert.ok(shakeEnvelope(1) > 0.1);
});

test("the charge vibration rotates by fractions of a degree at most", () => {
  let peak = 0;
  for (let elapsed = 0; elapsed <= 4000; elapsed += 3) {
    peak = Math.max(peak, Math.abs(holdShake(1, elapsed).rotate));
  }
  assert.ok(peak > 0);
  assert.ok(peak <= HOLD_SHAKE_ROTATE_DEG + 1e-9);
});

test("the charge vibration is deterministic for a press frame", () => {
  assert.deepEqual(holdShake(0.8, 1234), holdShake(0.8, 1234));
  assert.notDeepEqual(holdShake(0.8, 500), holdShake(0.8, 530));
  assert.deepEqual(holdShake(1, Number.NaN), holdShake(1, 0));
});

test("out-of-range charges clamp to a still or fully shaking card", () => {
  assert.deepEqual(holdShake(2, 700), holdShake(1, 700));
  const still = holdShake(-1, 700);
  assert.equal(Math.abs(still.x), 0);
  assert.equal(Math.abs(still.y), 0);
  assert.equal(Math.abs(still.rotate), 0);
});
