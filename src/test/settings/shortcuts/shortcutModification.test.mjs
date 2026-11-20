/**
 * Shortcut binding provenance.
 *
 * A user edit marks the command modified even after the bindings return to the
 * default; reset clears it. Import replacement and pointer repair stay
 * programmatic and never mark a command.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { registerEditorShortcuts } from "../../../core/edit/shortcuts/shortcutCatalog.ts";
import { TIMELINE_WHEEL_SHORTCUT_IDS } from "../../../core/edit/shortcuts/timelineWheel.ts";
import { POINTER_GESTURE_REPAIR_ID, shortcutRegistry } from "../../../core/shortcuts/registry.ts";
import { values } from "../../../core/state/values.ts";

const nextId = TIMELINE_WHEEL_SHORTCUT_IDS.lineNext;
const previousId = TIMELINE_WHEEL_SHORTCUT_IDS.linePrevious;

/** The current view of one command. */
function view(id) {
  return shortcutRegistry.shortcuts().find((entry) => entry.id === id);
}

test("a user edit keeps the command modified after the bindings return to default", () => {
  const dispose = registerEditorShortcuts();
  try {
    assert.equal(view(nextId).modified, false);
    assert.equal(shortcutRegistry.addBinding(nextId, { key: "PAUSE" }).ok, true);
    assert.equal(view(nextId).modified, true);

    assert.equal(shortcutRegistry.removeBinding(nextId, 1).ok, true);
    assert.equal(view(nextId).overridden, false);
    assert.equal(view(nextId).modified, true);

    shortcutRegistry.resetShortcut(nextId);
    assert.equal(view(nextId).modified, false);
    assert.equal(view(nextId).overridden, false);
  } finally {
    shortcutRegistry.resetShortcut(nextId);
    dispose();
  }
});

test("an import replacement is programmatic and does not mark the command", () => {
  const dispose = registerEditorShortcuts();
  try {
    assert.equal(shortcutRegistry.replaceAllBindings(nextId, ["PAUSE"]).ok, true);
    assert.equal(view(nextId).modified, false);

    shortcutRegistry.resetShortcut(nextId);
    assert.equal(view(nextId).modified, false);
  } finally {
    shortcutRegistry.resetShortcut(nextId);
    dispose();
  }
});

test("the pointer repair does not mark the command it touches", () => {
  const dispose = registerEditorShortcuts();
  try {
    assert.equal(shortcutRegistry.replaceAllBindings(nextId, ["PAUSE"]).ok, true);
    values.byId.set(POINTER_GESTURE_REPAIR_ID, 0);

    assert.equal(shortcutRegistry.repairPointerGestures(), 1);
    assert.equal(view(nextId).modified, false);
  } finally {
    values.byId.set(POINTER_GESTURE_REPAIR_ID, 1);
    shortcutRegistry.resetShortcut(nextId);
    dispose();
  }
});

test("resetAll clears every modification mark", () => {
  const dispose = registerEditorShortcuts();
  try {
    assert.equal(shortcutRegistry.addBinding(nextId, { key: "PAUSE" }).ok, true);
    assert.equal(shortcutRegistry.addBinding(previousId, { key: "PAUSE" }).ok, true);
    assert.equal(view(nextId).modified, true);
    assert.equal(view(previousId).modified, true);

    shortcutRegistry.resetAll();

    assert.equal(view(nextId).modified, false);
    assert.equal(view(previousId).modified, false);
  } finally {
    shortcutRegistry.resetShortcut(nextId);
    shortcutRegistry.resetShortcut(previousId);
    dispose();
  }
});
