/**
 * Repair for pointer gestures an older RPE hotkey import dropped.
 *
 * The importer used to replace every binding of a mapped command, so a migrated
 * `navigation.line.next` kept only its keyboard key. A profile that already
 * stored a wheel direction is left alone; only a missing gesture is added.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { registerEditorShortcuts } from "../../../core/edit/shortcuts/shortcutCatalog.ts";
import {
  TIMELINE_WHEEL_SHORTCUT_IDS,
  matchTimelineWheel,
} from "../../../core/edit/shortcuts/timelineWheel.ts";
import { POINTER_GESTURE_REPAIR_ID, shortcutRegistry } from "../../../core/shortcuts/registry.ts";
import { values } from "../../../core/state/values.ts";

/** Forget the repair level so the next call behaves like a first launch. */
function resetRepairLevel() {
  values.byId.set(POINTER_GESTURE_REPAIR_ID, 0);
}

test("a migrated command without a wheel gesture regains its default once", () => {
  const dispose = registerEditorShortcuts();
  const next = TIMELINE_WHEEL_SHORTCUT_IDS.lineNext;
  const previous = TIMELINE_WHEEL_SHORTCUT_IDS.linePrevious;
  try {
    // The pre-fix importer wrote only the RPE key, losing the wheel gesture.
    assert.equal(shortcutRegistry.replaceAllBindings(next, ["TAB"]).ok, true);
    resetRepairLevel();

    assert.equal(shortcutRegistry.repairPointerGestures(), 1);
    assert.deepEqual(shortcutRegistry.bindingsOf(next), [
      { key: "TAB", modifiers: [] },
      { key: "WHEELDOWN", modifiers: ["CTRL"] },
    ]);
    assert.deepEqual(matchTimelineWheel({ deltaY: 100, ctrlKey: true }), {
      kind: "line",
      direction: 1,
    });

    // The repair answers once: removing the gesture afterwards keeps it removed.
    assert.equal(shortcutRegistry.repairPointerGestures(), 0);
    assert.equal(shortcutRegistry.removeBinding(next, 1).ok, true);
    assert.equal(shortcutRegistry.repairPointerGestures(), 0);
    assert.deepEqual(shortcutRegistry.bindingsOf(next), [{ key: "TAB", modifiers: [] }]);
  } finally {
    shortcutRegistry.resetShortcut(next);
    shortcutRegistry.resetShortcut(previous);
    dispose();
  }
});

test("the repair leaves a stored wheel direction alone", () => {
  const dispose = registerEditorShortcuts();
  const next = TIMELINE_WHEEL_SHORTCUT_IDS.lineNext;
  const previous = TIMELINE_WHEEL_SHORTCUT_IDS.linePrevious;
  try {
    assert.equal(shortcutRegistry.replaceAllBindings(next, ["CTRL+WHEELUP"]).ok, true);
    assert.equal(shortcutRegistry.replaceAllBindings(previous, ["CTRL+WHEELDOWN"]).ok, true);
    resetRepairLevel();

    assert.equal(shortcutRegistry.repairPointerGestures(), 0);
    assert.deepEqual(shortcutRegistry.bindingsOf(next), [{ key: "WHEELUP", modifiers: ["CTRL"] }]);
    assert.deepEqual(shortcutRegistry.bindingsOf(previous), [
      { key: "WHEELDOWN", modifiers: ["CTRL"] },
    ]);
  } finally {
    shortcutRegistry.resetShortcut(next);
    shortcutRegistry.resetShortcut(previous);
    dispose();
  }
});

test("the repair leaves a command that already owns a pointer gesture alone", () => {
  const dispose = registerEditorShortcuts();
  const next = TIMELINE_WHEEL_SHORTCUT_IDS.lineNext;
  try {
    assert.equal(shortcutRegistry.replaceAllBindings(next, ["CTRL+WHEELDOWN", "TAB"]).ok, true);
    resetRepairLevel();
    assert.equal(shortcutRegistry.repairPointerGestures(), 0);
    assert.deepEqual(shortcutRegistry.bindingsOf(next), [
      { key: "WHEELDOWN", modifiers: ["CTRL"] },
      { key: "TAB", modifiers: [] },
    ]);
  } finally {
    shortcutRegistry.resetShortcut(next);
    dispose();
  }
});

test("the repair does not take a pointer gesture another command already owns", () => {
  const dispose = registerEditorShortcuts();
  const next = TIMELINE_WHEEL_SHORTCUT_IDS.lineNext;
  const other = shortcutRegistry.registerShortcut({
    id: "test.pointerRepair.other",
    category: "test",
    title: "test",
    scope: "editor",
    defaults: [{ key: "WHEELDOWN", modifiers: ["CTRL"] }],
  });
  try {
    assert.equal(shortcutRegistry.replaceAllBindings(next, ["TAB"]).ok, true);
    resetRepairLevel();
    assert.equal(shortcutRegistry.repairPointerGestures(), 0);
    assert.deepEqual(shortcutRegistry.bindingsOf(next), [{ key: "TAB", modifiers: [] }]);
  } finally {
    other();
    shortcutRegistry.resetShortcut(next);
    dispose();
  }
});
