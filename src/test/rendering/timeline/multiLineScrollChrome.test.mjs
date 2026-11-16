/** Verifies that unchanged multi-line scrollbar geometry does not notify React every frame. */
import assert from "node:assert/strict";
import test from "node:test";
import { createValue } from "../../../core/state/values.ts";
import { syncMultiLineChrome } from "../../../frontend/screens/editor/workspace/timeline/multiLine/multiLineChrome.ts";

test("multi-line chrome skips unchanged scrollbar snapshots", () => {
  const snapshot = createValue({
    initial: { visible: false, max: "0", value: "0" },
  });
  let notifications = 0;
  snapshot.subscribe(() => {
    notifications += 1;
  });
  const layout = {
    multiLineScrollState: { snapshot },
    multiLineScroll: { notes: 0, events: 0 },
    getSession: () => ({ notesMode: "multi", eventsMode: "single" }),
    panelCount: () => 741,
    panelWidth: () => 100,
    panelGap: () => 12,
  };

  syncMultiLineChrome(layout, "notes", 1600);
  syncMultiLineChrome(layout, "notes", 1600);

  assert.equal(notifications, 1);
  assert.deepEqual(snapshot.get(), { visible: true, max: "81380", value: "0" });
});
