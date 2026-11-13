/** The playback metronome must stay silent while the timing pane is hidden. */
import assert from "node:assert/strict";
import test from "node:test";
import { shouldRunMetronome } from "../../../frontend/screens/editor/inspector/bpm/metronomeVisibility.ts";

test("metronome runs only for the active timing inspector", () => {
  assert.equal(shouldRunMetronome("timing"), true);
  assert.equal(shouldRunMetronome("notes"), false);
  assert.equal(shouldRunMetronome(""), false);
});
