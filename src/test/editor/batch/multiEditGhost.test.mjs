/**
 * Verifies the batch-edit panel stops publishing its timeline ghost when its
 * pane closes, while realtime preview stays independent of the ghost chart.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createValue } from "../../../core/state/values.ts";
import { MultiEditPanel } from "../../../frontend/screens/editor/inspector/multiEdit/multiEdit.ts";

test("hiding the multi-edit panel drops its preview result", () => {
  let invalidations = 0;
  const panel = new MultiEditPanel(
    () => {
      throw new Error("preview lifecycle must not read the session");
    },
    {},
    {
      invalidate: () => {
        invalidations += 1;
      },
      notify: () => {},
      state: createValue({ initial: null }),
      scrollInspectorToTop: () => {},
    },
  );
  panel.active = true;
  panel.result = { chart: {}, changes: [] };
  panel.form = { isPreviewEnabled: () => true };

  assert.ok(panel.previewResult(), "an active pane with preview on publishes its timeline ghost");

  const before = invalidations;
  panel.hide();
  assert.equal(panel.previewResult(), null, "hide releases the published preview");
  assert.ok(invalidations > before, "hide requests an immediate repaint");
});
