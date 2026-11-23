/** Playback and paused seeking publish the timeline origin through one seam. */
import assert from "node:assert/strict";
import test from "node:test";
import { updatePlaybackViewportOrigin } from "../../../frontend/screens/editor/workspace/runtime/frame/playbackOrigin.ts";

function viewportSpy() {
  const calls = [];
  return {
    calls,
    setPlaybackActive(active) {
      calls.push(["active", active]);
    },
    setOrigin(value, source) {
      calls.push(["origin", value, source]);
      return true;
    },
  };
}

test("a paused seek and playback use the same timeline-origin owner", () => {
  const viewport = viewportSpy();

  updatePlaybackViewportOrigin(viewport, 12, false, false, { publishWhilePaused: true });
  updatePlaybackViewportOrigin(viewport, 13, true, false);

  assert.deepEqual(viewport.calls, [
    ["active", false],
    ["origin", 12, "playback"],
    ["active", true],
    ["origin", 13, "playback"],
  ]);
});

test("an idle frame does not overwrite a manually scrolled timeline", () => {
  const viewport = viewportSpy();

  updatePlaybackViewportOrigin(viewport, 24, false, false);

  assert.deepEqual(viewport.calls, [["active", false]]);
});
