/** Covers the fixed Escape cancel action and the complete selection clear. */
import assert from "node:assert/strict";
import test from "node:test";
import { fixedCancelAction } from "../../../core/edit/operations/keyboard.ts";
import { clearSelection } from "../../../core/edit/selection/control.ts";
import { isSystemCancelKey } from "../../../core/shortcuts/keyMatching.ts";
import { EDITOR_SHORTCUTS } from "../../../core/edit/shortcuts/shortcutCatalog.ts";

const idle = {
  hasPendingPlacement: false,
  hasSelection: false,
  samplingActive: false,
  curveMode: false,
  batchActive: false,
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

test("Escape is a fixed key and is not listed as an editor shortcut", () => {
  assert.equal(isSystemCancelKey({ key: "Escape" }), true);
  assert.equal(isSystemCancelKey({ key: "Escape", shiftKey: true }), false);
  assert.equal(isSystemCancelKey({ key: "Escape", isComposing: true }), false);
  assert.equal(
    EDITOR_SHORTCUTS.some((shortcut) => shortcut.id === "placement.cancel"),
    false,
  );
  assert.equal(
    EDITOR_SHORTCUTS.some((shortcut) => shortcut.id === "selection.clear"),
    false,
  );
});

test("Escape cancels a pending placement before clearing the selection", () => {
  assert.equal(
    fixedCancelAction(
      { key: "Escape" },
      { ...idle, hasPendingPlacement: true, hasSelection: true },
    ),
    "placement.cancel",
  );
  assert.equal(
    fixedCancelAction({ key: "Escape" }, { ...idle, hasSelection: true }),
    "selection.clear",
  );
  assert.equal(fixedCancelAction({ key: "Escape" }, idle), undefined);
});

test("surfaces that own Escape keep it for themselves", () => {
  for (const state of [
    { ...idle, hasSelection: true, samplingActive: true },
    { ...idle, hasSelection: true, curveMode: true },
    { ...idle, hasSelection: true, batchActive: true },
  ]) {
    assert.equal(fixedCancelAction({ key: "Escape" }, state), undefined);
  }
});
