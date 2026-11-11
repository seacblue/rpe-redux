/** Workspace modes replace the timeline one at a time and remember the return pane. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  closeWorkspaceMode,
  getWorkspaceModeState,
  openWorkspaceMode,
  registerWorkspaceMode,
} from "../../../frontend/screens/editor/workspace/container/workspaceModes.ts";

const mode = (id, order = 10) => ({
  id,
  order,
  label: "chrome.pane.bpm",
  icon: "bpm",
  component: () => null,
});

test("an unknown or blank mode never replaces the timeline", () => {
  const before = getWorkspaceModeState();
  assert.equal(openWorkspaceMode("test:missing-mode"), false);
  assert.equal(openWorkspaceMode("   "), false);
  assert.deepEqual(getWorkspaceModeState(), before);
});

test("opening a mode records the return pane and closing restores it", () => {
  const dispose = registerWorkspaceMode(mode("test:workspace-mode-a"));
  assert.equal(openWorkspaceMode("test:workspace-mode-a", "timing"), true);
  assert.deepEqual(getWorkspaceModeState(), {
    id: "test:workspace-mode-a",
    returnPane: "timing",
  });
  // The same open call keeps the pane rather than clearing it.
  assert.equal(openWorkspaceMode("test:workspace-mode-a", ""), true);
  assert.equal(getWorkspaceModeState().returnPane, "timing");
  assert.equal(closeWorkspaceMode(), "timing");
  assert.deepEqual(getWorkspaceModeState(), { id: "", returnPane: "" });
  dispose();
});

test("only one mode is active at a time", () => {
  const disposeA = registerWorkspaceMode(mode("test:workspace-mode-b", 20));
  const disposeB = registerWorkspaceMode(mode("test:workspace-mode-c", 30));
  assert.equal(openWorkspaceMode("test:workspace-mode-b", "lines"), true);
  assert.equal(openWorkspaceMode("test:workspace-mode-c", "assets"), true);
  assert.deepEqual(getWorkspaceModeState(), {
    id: "test:workspace-mode-c",
    returnPane: "assets",
  });
  closeWorkspaceMode();
  disposeB();
  disposeA();
});
