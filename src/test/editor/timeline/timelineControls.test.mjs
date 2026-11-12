/** Fractional vertical-grid values survive the toolbar commit path. */
import assert from "node:assert/strict";
import test from "node:test";
import { editorGridCount } from "../../../core/edit/state/publishedValues.ts";
import {
  bindTimelineControlInputs,
  commitTimelineNumeric,
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
