/** Verifies cached timeline projections preserve the chart coordinate contract. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  clampNoteHorizontal,
  createNotePanelProjection,
  createVerticalBeatProjection,
  noteHorizontal,
  verticalAtLineBeat,
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
    configuredWidth: 180,
    visibleCount: 3,
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
