/** The transport stretch rail maps its travel onto the supported scale range. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  TIMELINE_SCALE_DEFAULT,
  TIMELINE_SCALE_MAX,
  TIMELINE_SCALE_MIN,
} from "../../../core/edit/timeline/timelineScale.ts";
import {
  STRETCH_BAR_MAX,
  stretchBarPercent,
  stretchBarRatio,
  stretchBarScale,
} from "../../../frontend/chrome/transport/stretchBar.ts";

test("the stretch rail covers the minimum, authored default, and maximum", () => {
  assert.equal(stretchBarScale(0), TIMELINE_SCALE_MIN);
  assert.equal(stretchBarScale(STRETCH_BAR_MAX / 2), TIMELINE_SCALE_DEFAULT);
  assert.equal(stretchBarScale(STRETCH_BAR_MAX), TIMELINE_SCALE_MAX);
  assert.equal(stretchBarRatio(TIMELINE_SCALE_MIN), 0);
  assert.equal(stretchBarRatio(TIMELINE_SCALE_DEFAULT), STRETCH_BAR_MAX / 2);
  assert.equal(stretchBarRatio(TIMELINE_SCALE_MAX), STRETCH_BAR_MAX);
});

test("every rail position round-trips through the scale", () => {
  for (let ratio = 0; ratio <= STRETCH_BAR_MAX; ratio += 1) {
    assert.equal(stretchBarRatio(stretchBarScale(ratio)), ratio, `rail position ${ratio}`);
  }
});

test("fractional rail positions keep the drag continuous", () => {
  for (const ratio of [0.1, 12.3, 33.3, 50.1, 87.6, 99.9]) {
    const roundTrip = stretchBarRatio(stretchBarScale(ratio));
    assert.ok(Math.abs(roundTrip - ratio) < 1e-6, `${ratio} round-tripped to ${roundTrip}`);
  }
});

test("the rail clamps invalid travel and reports the default as 100%", () => {
  assert.equal(stretchBarScale(-25), TIMELINE_SCALE_MIN);
  assert.equal(stretchBarScale(500), TIMELINE_SCALE_MAX);
  assert.equal(stretchBarRatio(Number.NaN), STRETCH_BAR_MAX / 2);
  assert.equal(stretchBarPercent(TIMELINE_SCALE_MIN), 25);
  assert.equal(stretchBarPercent(TIMELINE_SCALE_DEFAULT), 100);
  assert.equal(stretchBarPercent(TIMELINE_SCALE_MAX), 400);
});
