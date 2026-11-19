/** Fractional vertical-grid values and transport scale writes share one commit path. */
import assert from "node:assert/strict";
import test from "node:test";
import { editorGridCount, editorScale } from "../../../core/edit/state/publishedValues.ts";
import {
  bindTimelineControlInputs,
  commitTimelineNumeric,
  commitTimelineScale,
  setTimelineScale,
} from "../../../frontend/screens/editor/toolbar/timelineControls.ts";

test("grid count accepts a fractional value", () => {
  const timeline = { viewport: { division: 4, gridCount: 11, scale: 100 } };
  const session = { division: 4 };
  const dispose = bindTimelineControlInputs({
    timeline,
    getSession: () => session,
    updateCurvePanel: () => {},
    persistEditor: () => {},
    invalidate: () => {},
  });

  try {
    commitTimelineNumeric("gridCount", "11.5");
    assert.equal(timeline.viewport.gridCount, 11.5);
    assert.equal(editorGridCount.get(), "11.5");
  } finally {
    dispose();
    editorGridCount.set("11");
  }
});

test("a stretch preview clamps the scale and defers persistence until commit", () => {
  let persisted = 0;
  let invalidated = 0;
  let cancelled = 0;
  const timeline = { viewport: { division: 4, gridCount: 11, scale: 500 } };
  const dispose = bindTimelineControlInputs({
    timeline,
    getSession: () => ({ division: 4 }),
    updateCurvePanel: () => {},
    persistEditor: () => {
      persisted += 1;
    },
    invalidate: () => {
      invalidated += 1;
    },
    cancelTimelineZoom: () => {
      cancelled += 1;
    },
  });

  try {
    setTimelineScale(1000);
    assert.equal(timeline.viewport.scale, 1000);
    // The transport row keeps its gesture draft; the published value waits for
    // the commit so a drag does not repaint the whole toolbar per pointer step.
    assert.equal(editorScale.get(), "500");
    assert.equal(invalidated, 1);
    assert.equal(cancelled, 1);
    assert.equal(persisted, 0);

    setTimelineScale(999999);
    assert.equal(timeline.viewport.scale, 2000);
    assert.equal(editorScale.get(), "500");
    assert.equal(invalidated, 2);
    assert.equal(persisted, 0);

    commitTimelineScale();
    assert.equal(editorScale.get(), "2000");
    assert.equal(persisted, 1);
  } finally {
    dispose();
    editorScale.set("500");
  }
});
