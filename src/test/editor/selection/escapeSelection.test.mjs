/** Covers Escape's editor-selection match and the complete selection clear. */
import assert from "node:assert/strict";
import test from "node:test";
import { clearSelection } from "../../../core/edit/selection/control.ts";
import {
  matchEditorShortcut,
  registerEditorShortcuts,
} from "../../../core/edit/shortcuts/shortcutCatalog.ts";

const shortcutContext = {
  atHome: false,
  documentOpen: true,
  modal: "none",
  capturing: false,
  developerMode: false,
  textEntry: false,
  surface: null,
};

test("clearSelection removes single-line and multi-line note and event selections", () => {
  const session = {
    selection: new Set([1]),
    eventSelection: new Set(["moveXEvents:0"]),
    multiLineSelection: new Map([[2, new Set([3])]]),
    multiEventSelection: new Map([[2, new Set(["alphaEvents:1"])]]),
    multiSelectionIntent: "events",
  };

  assert.equal(clearSelection(session), true);
  assert.equal(session.selection.size, 0);
  assert.equal(session.eventSelection.size, 0);
  assert.equal(session.multiLineSelection.size, 0);
  assert.equal(session.multiEventSelection.size, 0);
  assert.equal(session.multiSelectionIntent, null);
  assert.equal(clearSelection(session), false);
});

test("Escape cancels a pending Hold or event before clearing the selection", () => {
  const dispose = registerEditorShortcuts();
  try {
    const pending = {
      area: "notes",
      hasSelection: true,
      hasPendingPlacement: true,
      hasEventSelection: false,
      samplingActive: false,
      curveMode: false,
    };
    assert.equal(
      matchEditorShortcut({ key: "Escape" }, pending, shortcutContext),
      "placement.cancel",
    );
    assert.equal(
      matchEditorShortcut({ key: "Escape" }, { ...pending, area: "events" }, shortcutContext),
      "placement.cancel",
    );
    assert.notEqual(
      matchEditorShortcut({ key: "Escape" }, { ...pending, samplingActive: true }, shortcutContext),
      "placement.cancel",
    );
  } finally {
    dispose();
  }
});

test("Escape clears chart selection only after sampling and curve contexts yield", () => {
  const dispose = registerEditorShortcuts();
  try {
    const selected = {
      area: "notes",
      hasSelection: true,
      hasEventSelection: false,
      samplingActive: false,
      curveMode: false,
    };
    assert.equal(
      matchEditorShortcut({ key: "Escape" }, selected, shortcutContext),
      "selection.clear",
    );
    assert.notEqual(
      matchEditorShortcut(
        { key: "Escape" },
        { ...selected, samplingActive: true },
        shortcutContext,
      ),
      "selection.clear",
    );
    assert.notEqual(
      matchEditorShortcut({ key: "Escape" }, { ...selected, curveMode: true }, shortcutContext),
      "selection.clear",
    );
  } finally {
    dispose();
  }
});
