/** Multi-line note and event panels share one visible width and gap contract. */
import assert from "node:assert/strict";
import test from "node:test";
import { TimelineViewport } from "../../../frontend/screens/editor/workspace/timeline/viewport/timelineViewport.ts";

function fakeViewport() {
  const session = {
    notesMode: "multi",
    eventsMode: "multi",
    multiLineActive: true,
    multiLineMode: "notes",
    multiLineIndices: [0, 1, 2, 3],
    targetLineIndices: [0, 1, 2, 3],
    lineIndex: 0,
  };
  const tempo = {
    seconds: (beat) => beat,
    beat: (seconds) => seconds,
  };
  return new TimelineViewport(
    {},
    {},
    () => session,
    () => tempo,
    () => [],
    {},
    { snapshot: { set() {} } },
  );
}

test("multi-line note and event panels use the same layout", () => {
  const viewport = fakeViewport();

  assert.deepEqual(viewport.panelLayout("events"), viewport.panelLayout("notes"));
});
