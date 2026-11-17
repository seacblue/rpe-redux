/** Verifies cached timeline projections preserve the chart coordinate contract. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  clampMultiLineWindowWidth,
  clampNoteHorizontal,
  createNotePanelProjection,
  createVerticalBeatProjection,
  MULTI_LINE_WINDOW_WIDTH_DEFAULT,
  multiLineWidthRatio,
  noteHorizontal,
  panelGap,
  panelStride,
  panelWidth,
  verticalAtLineBeat,
  visiblePanelRange,
} from "../../../core/edit/timeline/timelineCoordinates.ts";

const tempo = {
  points: [
    { beat: 0, secondsPerBeat: 0.5 },
    { beat: 8, secondsPerBeat: 0.25 },
  ],
  seconds(beat, factor = 1) {
    const first = Math.min(beat, 8);
    const second = Math.max(0, beat - 8);
    return (first * 0.5 + second * 0.25) / factor;
  },
};
const scale = { origin: 2, factor: 1, scale: 240, judgementOffset: 12 };

test("vertical projection matches per-beat timeline geometry", () => {
  const project = createVerticalBeatProjection(720, scale, tempo);
  for (const beat of [-4, 0, 2, 8, 16, 32]) {
    assert.equal(project(beat), verticalAtLineBeat(beat, 720, scale, 1, tempo));
  }
});

test("note panel projection matches per-note horizontal geometry", () => {
  const layout = {
    active: true,
    count: 3,
    widthRatio: 0.25,
    gapRatio: 0.04,
    gapMinimum: 12,
  };
  const projection = createNotePanelProjection(12, 4, 180, 1, 720, layout, 36);
  for (const position of [-675, -100, 0, 500, 675]) {
    assert.equal(
      projection.horizontal(position),
      noteHorizontal(position, 12, 4, 180, 1, 720, layout, 36),
    );
  }
  assert.equal(projection.clamp(120, 24), clampNoteHorizontal(120, 24, 720, 1, layout, 36));
});

test("multi-line windows take the configured fraction of the timeline width", () => {
  const layout = { active: true, count: 6, widthRatio: 0.25, gapRatio: 0.125, gapMinimum: 0 };
  assert.equal(panelWidth(800, layout), 200);
  assert.equal(panelGap(800, layout), 25);
  assert.equal(panelStride(800, layout), 225);
  assert.deepEqual(visiblePanelRange(800, layout, 0), [0, 3]);
  assert.deepEqual(visiblePanelRange(800, layout, 450), [2, 5]);
});

test("a narrower window fits more windows while one panel still fills the width", () => {
  assert.equal(panelWidth(1000, { active: true, count: 10, widthRatio: 0.1 }), 100);
  assert.equal(panelWidth(1000, { active: true, count: 1, widthRatio: 0.1 }), 1000);
  assert.equal(panelWidth(1000, { active: false, count: 10, widthRatio: 0.1 }), 1000);
  assert.equal(panelGap(1000, { active: true, count: 1, widthRatio: 0.1, gapRatio: 0.125 }), 0);
});

test("a layout without a width ratio still fits every panel into the viewport", () => {
  assert.equal(panelWidth(800, { active: true, count: 4, gapRatio: 0, gapMinimum: 0 }), 200);
  assert.equal(panelWidth(800, { active: true, count: 4, widthRatio: 2 }), 800);
});

test("multi-line window widths clamp into the supported range", () => {
  assert.equal(clampMultiLineWindowWidth(0), 0.01);
  assert.equal(clampMultiLineWindowWidth(4), 1);
  assert.equal(clampMultiLineWindowWidth(Number.NaN), MULTI_LINE_WINDOW_WIDTH_DEFAULT);
  assert.equal(MULTI_LINE_WINDOW_WIDTH_DEFAULT, 0.5);
  assert.equal(clampMultiLineWindowWidth(0.334), 0.33);
});

test("the default window scale shows three and a half event windows edge to edge", () => {
  const width = 862;
  const gapRatio = 1 / 8;
  const layout = {
    active: true,
    count: 12,
    widthRatio: multiLineWidthRatio(MULTI_LINE_WINDOW_WIDTH_DEFAULT, gapRatio),
    gapRatio,
    gapMinimum: 0,
  };
  const panel = panelWidth(width, layout);
  // Three whole windows plus half of the fourth reach the trailing edge exactly.
  assert.ok(Math.abs(3 * panelStride(width, layout) + panel / 2 - width) < 1e-9);
  assert.deepEqual(visiblePanelRange(width, layout, 0), [0, 3]);
});

test("note windows reach the same window count with their own gap", () => {
  const width = 1000;
  const gapRatio = 0.04;
  const layout = {
    active: true,
    count: 12,
    widthRatio: multiLineWidthRatio(MULTI_LINE_WINDOW_WIDTH_DEFAULT, gapRatio),
    gapRatio,
    gapMinimum: 0,
  };
  const panel = panelWidth(width, layout);
  assert.ok(Math.abs(3 * panelStride(width, layout) + panel / 2 - width) < 1e-9);
  assert.ok(panelGap(width, layout) < 12);
});

test("whole-number window counts fill the timeline without a remainder", () => {
  const width = 1000;
  const gapRatio = 1 / 8;
  const layout = {
    active: true,
    count: 20,
    widthRatio: multiLineWidthRatio(0.25, gapRatio),
    gapRatio,
    gapMinimum: 0,
  };
  const panel = panelWidth(width, layout);
  assert.ok(Math.abs(7 * panel + 6 * panelGap(width, layout) - width) < 1e-9);
});

test("a smaller window scale widens the windows", () => {
  const gapRatio = 1 / 8;
  assert.ok(multiLineWidthRatio(0.2, gapRatio) < multiLineWidthRatio(0.5, gapRatio));
  assert.ok(multiLineWidthRatio(0.5, gapRatio) < multiLineWidthRatio(1, gapRatio));
  assert.ok(Math.abs(multiLineWidthRatio(1, gapRatio) - 1 / 1.875) < 1e-12);
  assert.ok(multiLineWidthRatio(0.01, gapRatio) < 0.01);
});
