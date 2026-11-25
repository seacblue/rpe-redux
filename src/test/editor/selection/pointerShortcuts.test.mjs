/** Verifies that pointer selection meanings are explicit, distinct, and rebindable. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CURVE_QUICK_PICK_SHORTCUT_ID,
  matchEditorShortcut,
  matchesEditorShortcut,
  registerEditorShortcuts,
} from "../../../core/edit/shortcuts/shortcutCatalog.ts";
import { SELECTION_SHORTCUT_IDS } from "../../../core/edit/selection/control.ts";
import { shortcutRegistry } from "../../../core/shortcuts/registry.ts";

const shortcutContext = {
  atHome: false,
  documentOpen: true,
  modal: "none",
  capturing: false,
  developerMode: false,
  textEntry: false,
  surface: null,
};

test("selection pointer meanings expose the requested defaults", () => {
  const dispose = registerEditorShortcuts();
  try {
    const notes = { area: "notes", hasSelection: false, surface: "timeline" };
    const events = { area: "events", hasSelection: false, surface: "timeline" };
    const preview = { area: "notes", hasSelection: false, surface: "preview" };
    const left = { button: 0, ctrlKey: false, shiftKey: false, altKey: false };
    const ctrlLeft = { ...left, ctrlKey: true };
    const shiftLeft = { ...left, shiftKey: true };
    const altShiftLeft = { ...shiftLeft, altKey: true };
    const right = { button: 2, ctrlKey: false, shiftKey: false, altKey: false };

    assert.equal(
      matchesEditorShortcut(SELECTION_SHORTCUT_IDS.note, left, notes, shortcutContext),
      true,
    );
    assert.equal(
      matchesEditorShortcut(SELECTION_SHORTCUT_IDS.event, left, events, shortcutContext),
      true,
    );
    assert.equal(
      matchesEditorShortcut(SELECTION_SHORTCUT_IDS.line, left, preview, shortcutContext),
      true,
    );
    assert.equal(
      matchesEditorShortcut(SELECTION_SHORTCUT_IDS.toggle, ctrlLeft, notes, shortcutContext),
      true,
    );
    assert.equal(
      matchesEditorShortcut(SELECTION_SHORTCUT_IDS.toggle, shiftLeft, notes, shortcutContext),
      false,
    );
    assert.equal(
      matchesEditorShortcut(SELECTION_SHORTCUT_IDS.marquee, shiftLeft, notes, shortcutContext),
      true,
    );
    assert.equal(
      matchesEditorShortcut(
        SELECTION_SHORTCUT_IDS.marqueeRemove,
        altShiftLeft,
        notes,
        shortcutContext,
      ),
      true,
    );
    assert.equal(
      matchesEditorShortcut(SELECTION_SHORTCUT_IDS.sweepAdd, left, notes, shortcutContext),
      true,
    );
    assert.equal(
      matchesEditorShortcut(SELECTION_SHORTCUT_IDS.sweepRemove, right, notes, shortcutContext),
      true,
    );
  } finally {
    dispose();
  }
});

test("quick curve generation is a keyboard shortcut, not a mouse chord", () => {
  const dispose = registerEditorShortcuts();
  try {
    const timeline = { area: "notes", hasSelection: false, surface: "timeline" };
    assert.equal(shortcutRegistry.replaceAllBindings(CURVE_QUICK_PICK_SHORTCUT_ID, ["G"]).ok, true);
    assert.equal(
      matchEditorShortcut({ key: "G" }, timeline, shortcutContext),
      CURVE_QUICK_PICK_SHORTCUT_ID,
    );
    assert.equal(matchEditorShortcut({ button: 0 }, timeline, shortcutContext), undefined);
  } finally {
    shortcutRegistry.resetShortcut(CURVE_QUICK_PICK_SHORTCUT_ID);
    dispose();
  }
});
