/** Complete editor mode snapshots coalesce rapid changes and swap atomically. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createEditorModeHistory } from "../../../frontend/screens/editor/workspace/runtime/commands/modeHistory.ts";

const snapshot = (showNotes, showEvents, showPreview) => ({
  showNotes,
  showEvents,
  showPreview,
});

test("rapid region changes commit only their final complete snapshot", () => {
  const history = createEditorModeHistory(snapshot(true, true, true));

  history.observe(snapshot(false, true, true), 100);
  history.observe(snapshot(false, false, true), 599);

  assert.deepEqual(history.swap(), snapshot(true, true, true));
  assert.deepEqual(history.swap(), snapshot(false, false, true));
});

test("preview and empty layouts remain valid snapshots", () => {
  const history = createEditorModeHistory(snapshot(false, false, true));

  history.observe(snapshot(false, false, false), 100);

  assert.deepEqual(history.swap(), snapshot(false, false, true));
  assert.deepEqual(history.swap(), snapshot(false, false, false));
});

test("a change after the transaction window starts a new previous snapshot", () => {
  const history = createEditorModeHistory(snapshot(true, true, true));

  history.observe(snapshot(false, true, true), 100);
  history.observe(snapshot(false, false, true), 601);

  assert.deepEqual(history.swap(), snapshot(false, true, true));
  assert.deepEqual(history.swap(), snapshot(false, false, true));
});
