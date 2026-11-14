/** The update Changelog launcher defers automatic presentation during playback. */
import assert from "node:assert/strict";
import test from "node:test";
import { editorPlaying } from "../../../core/edit/state/publishedValues.ts";
import {
  bindUpdateChangelogLauncher,
  requestUpdateChangelog,
} from "../../../frontend/screens/settings/updates/changelogLauncher.ts";

test("an idle update request opens immediately", () => {
  editorPlaying.set(false);
  let openings = 0;
  const dispose = bindUpdateChangelogLauncher(() => {
    openings += 1;
  });
  requestUpdateChangelog();
  dispose();
  assert.equal(openings, 1);
});

test("a playing update request opens after playback stops", () => {
  editorPlaying.set(true);
  let openings = 0;
  const dispose = bindUpdateChangelogLauncher(() => {
    openings += 1;
  });
  requestUpdateChangelog();
  assert.equal(openings, 0);
  editorPlaying.set(false);
  dispose();
  assert.equal(openings, 1);
});
