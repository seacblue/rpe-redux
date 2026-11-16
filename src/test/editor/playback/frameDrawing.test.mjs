/** Playback frames keep the timeline playhead pinned during the pending start. */
import assert from "node:assert/strict";
import test from "node:test";
import { updatePlaybackViewportOrigin } from "../../../frontend/screens/editor/workspace/runtime/frame/playbackOrigin.ts";

test("pending playback keeps the red playhead on the bottom anchor", () => {
  const calls = [];
  const viewport = {
    setPlaybackActive(active) {
      calls.push({ kind: "active", active });
    },
    setOrigin(value, source) {
      calls.push({ kind: "origin", value, source });
      return true;
    },
  };

  updatePlaybackViewportOrigin(viewport, -1, false, true);

  assert.deepEqual(calls, [
    { kind: "active", active: true },
    { kind: "origin", value: -1, source: "playback" },
  ]);
});

test("running playback updates the origin for positive chart time too", () => {
  const origins = [];
  const viewport = {
    setPlaybackActive() {},
    setOrigin(value) {
      origins.push(value);
      return true;
    },
  };

  updatePlaybackViewportOrigin(viewport, 12.5, true, false);

  assert.deepEqual(origins, [12.5]);
});
