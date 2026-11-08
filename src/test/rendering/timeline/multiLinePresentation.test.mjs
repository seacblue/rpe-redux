/** Verify that split multi-line panels scale note geometry with their visible width. */
import assert from "node:assert/strict";
import test from "node:test";
import { noteWidth } from "../../../core/edit/timeline/timelineCoordinates.ts";
import {
  multiLinePanelScale,
  multiLineScale,
} from "../../../frontend/screens/editor/workspace/timeline/multiLine/multiLinePresentation.ts";

test("split multi-line panel scale affects both horizontal and vertical geometry", () => {
  const panelScale = multiLinePanelScale(400, 800, true);

  assert.equal(panelScale, 0.5);
  assert.equal(noteWidth(2 * panelScale, 1), 68);
  assert.equal(multiLineScale(500, 1, true, panelScale), 250);
});

test("single or merged timelines keep their base geometry scale", () => {
  assert.equal(multiLinePanelScale(400, 800, false), 1);
  assert.equal(multiLineScale(500, 1, true, 1), 500);
});
