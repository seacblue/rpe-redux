/** Verifies the HUD's RAF and painted-frame rate windows stay separate. */
import assert from "node:assert/strict";
import test from "node:test";
import { updateMeasuredFrameRates } from "../../../frontend/screens/editor/workspace/runtime/frame/frameClock.ts";

test("rate window reports raw rAF callbacks and painted frames separately", () => {
  const state = {
    frameSampleStart: 0,
    frameSampleCount: 72,
    frameSampleCallbacks: 0,
    measuredFps: 0,
    measuredPaintFps: 0,
    animationCallbacks: 144,
  };
  updateMeasuredFrameRates(state, 1000);

  assert.equal(state.measuredFps, 144);
  assert.equal(state.measuredPaintFps, 72);
  assert.equal(state.frameSampleStart, 1000);
  assert.equal(state.frameSampleCount, 0);
  assert.equal(state.frameSampleCallbacks, 144);

  state.frameSampleCount = 36;
  state.animationCallbacks = 216;
  updateMeasuredFrameRates(state, 1500);
  assert.equal(state.measuredFps, 144);
  assert.equal(state.measuredPaintFps, 72);
});

test("rate window waits for 500 ms and ignores a non-advancing timestamp", () => {
  const state = {
    frameSampleStart: 1000,
    frameSampleCount: 10,
    frameSampleCallbacks: 30,
    measuredFps: 60,
    measuredPaintFps: 60,
    animationCallbacks: 60,
  };
  updateMeasuredFrameRates(state, 1200);
  assert.equal(state.measuredFps, 60);
  assert.equal(state.measuredPaintFps, 60);
  assert.equal(state.frameSampleStart, 1000);

  updateMeasuredFrameRates(state, 1000);
  assert.equal(state.measuredFps, 60);
  assert.equal(state.frameSampleStart, 1000);
});
