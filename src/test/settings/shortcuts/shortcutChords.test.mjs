/** Held-key chords, recording them, and scope-aware collision reporting. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalText,
  displayText,
  parseShortcut,
  shortcutConflictKey,
  shortcutIssue,
  shortcutKeys,
} from "../../../core/shortcuts/keys.ts";
import { matches, recordShortcut } from "../../../core/shortcuts/keyMatching.ts";
import { clearShortcutKeys, pressShortcutKey } from "../../../core/shortcuts/inputKeys.ts";
import { ShortcutRegistry } from "../../../core/shortcuts/registry.ts";
import { shortcutScopesOverlap } from "../../../core/shortcuts/scope.ts";
import {
  advanceShortcutCapture,
  createShortcutCaptureState,
} from "../../../frontend/screens/settings/shortcuts/shortcutCapture.ts";

test("a binding reads and writes held-key chords in one canonical order", () => {
  const parsed = parseShortcut("CTRL+E+MOUSE2");
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.shortcut, {
    key: "MOUSE2",
    modifiers: ["CTRL"],
    keys: ["E"],
  });
  assert.deepEqual(shortcutKeys({ key: "MOUSE2", keys: ["E"] }), ["E", "MOUSE2"]);
  assert.equal(canonicalText({ key: "MOUSE2", keys: ["E"] }), "E+MOUSE2");
  assert.equal(canonicalText({ key: "E", keys: ["MOUSE2"] }), "E+MOUSE2");
  assert.equal(displayText({ key: "MOUSE2", keys: ["E"] }), "E + Mouse Right");
  assert.equal(canonicalText({ key: "MOUSE2", modifiers: ["MOD"], keys: ["E"] }), "MOD+E+MOUSE2");
  assert.equal(
    shortcutConflictKey({ key: "MOUSE2", modifiers: ["MOD"], keys: ["E"] }),
    shortcutConflictKey({ key: "E", modifiers: ["CTRL"], keys: ["MOUSE2"] }),
  );
});

test("invalid chords are refused at the key model boundary", () => {
  assert.equal(shortcutIssue({ key: "E", keys: ["E"] }), "shortcuts.error.duplicateKey");
  assert.equal(
    shortcutIssue({ key: "A", keys: ["B", "C", "D", "E"] }),
    "shortcuts.error.tooManyKeys",
  );
  assert.equal(shortcutIssue({ key: "CTRL", keys: ["E"] }), "shortcuts.error.unsupportedKey");
  assert.equal(parseShortcut("CTRL+E+MOUSE2+MOUSE0").ok, true);
  assert.equal(parseShortcut("CTRL+E+MOUSE2+MOUSE0+SPACE+W").ok, false);
});

test("a chord matches only when every held key is down", () => {
  const chord = { key: "MOUSE2", keys: ["E"] };
  assert.equal(matches({ button: 2 }, chord), false);
  assert.equal(matches({ button: 2 }, chord, ["E"]), true);
  assert.equal(matches({ button: 2 }, chord, new Set(["E", "MOUSE0"])), true);
  // The trigger may be the keyboard key while the mouse button is held.
  assert.equal(matches({ key: "e", code: "KeyE" }, chord, ["MOUSE2"]), true);
  assert.equal(matches({ key: "e", code: "KeyE" }, chord, []), false);
  // Extra held keys never disable an ordinary binding.
  assert.equal(matches({ key: "e", code: "KeyE" }, { key: "E" }, ["MOUSE2"]), true);
});

test("the recorder adds held keys and a mouse release commits the chord", () => {
  assert.deepEqual(recordShortcut({ button: 2 }, ["E"]), {
    key: "MOUSE2",
    keys: ["E"],
    modifiers: [],
  });

  let state = advanceShortcutCapture(createShortcutCaptureState(), {
    type: "keydown",
    event: { key: "e", code: "KeyE" },
  }).state;
  assert.deepEqual(state.candidate, { key: "E", modifiers: [] });

  state = advanceShortcutCapture(state, {
    type: "pointerdown",
    event: { button: 2 },
  }).state;
  assert.deepEqual(state.candidate, { key: "MOUSE2", keys: ["E"], modifiers: [] });

  const released = advanceShortcutCapture(state, {
    type: "pointerup",
    event: { button: 2 },
  });
  assert.deepEqual(released.commit, { key: "MOUSE2", keys: ["E"], modifiers: [] });
  assert.deepEqual(released.state, createShortcutCaptureState());
});

test("chord dispatch prefers the more specific binding", () => {
  const registry = new ShortcutRegistry();
  const category = registry.registerCategory({ id: "test.chords", title: "Chords", order: 0 });
  const disposePlain = registry.registerShortcut({
    id: "test.chords.plain",
    category: category.id,
    title: "Plain right click",
    defaults: [{ key: "MOUSE2" }],
    scope: "editor",
  });
  const disposeChord = registry.registerShortcut({
    id: "test.chords.e",
    category: category.id,
    title: "Hold E and right click",
    defaults: [{ key: "MOUSE2", keys: ["E"] }],
    scope: "editor",
  });
  try {
    assert.equal(registry.match({ button: 2 })?.id, "test.chords.plain");
    pressShortcutKey("KeyE", "E");
    assert.equal(registry.match({ button: 2 })?.id, "test.chords.e");
  } finally {
    clearShortcutKeys();
    disposeChord();
    disposePlain();
    category.dispose();
  }
});

test("scope overlap excludes disjoint scopes and keeps parent-child scopes", () => {
  assert.equal(shortcutScopesOverlap("editor", "modal"), false);
  assert.equal(shortcutScopesOverlap("editor", "surface"), false);
  assert.equal(shortcutScopesOverlap("workspace", "surface"), false);
  assert.equal(shortcutScopesOverlap("app", "modal"), false);
  assert.equal(shortcutScopesOverlap("app", "editor"), true);
  assert.equal(shortcutScopesOverlap("app", "surface"), true);
  assert.equal(shortcutScopesOverlap("workspace", "editor"), true);
  assert.equal(shortcutScopesOverlap("instrument", "app"), true);
  assert.equal(shortcutScopesOverlap("emergency", "modal"), true);
});

test("conflicts are per binding and only when their scopes can coexist", () => {
  const registry = new ShortcutRegistry();
  const category = registry.registerCategory({ id: "test.scope", title: "Scope", order: 0 });
  const register = (id, scope, defaults) =>
    registry.registerShortcut({
      id,
      category: category.id,
      title: id,
      defaults,
      scope,
    });
  const disposers = [
    register("test.scope.editor", "editor", [{ key: "E" }]),
    register("test.scope.modal", "modal", [{ key: "E" }]),
    register("test.scope.app", "app", [{ key: "E" }]),
    register("test.scope.appAlternate", "app", [{ key: "Q" }, { key: "E", keys: ["MOUSE2"] }]),
    register("test.scope.editorChord", "editor", [{ key: "MOUSE2", keys: ["E"] }]),
  ];
  try {
    const views = registry.shortcuts();
    const byId = (id) => views.find((view) => view.id === id);
    // Editor and app can both run; modal never can share the editor's key.
    // E and E+MOUSE2 are different inputs, so they do not collide with each
    // other even though one state can hold both keys.
    assert.deepEqual(byId("test.scope.editor").conflicts, ["test.scope.app"]);
    assert.deepEqual(byId("test.scope.modal").conflicts, []);
    // One alternate binding collides without marking the other one.
    assert.deepEqual(Object.keys(byId("test.scope.appAlternate").bindingConflicts), ["E+MOUSE2"]);
    assert.deepEqual(byId("test.scope.appAlternate").conflicts, ["test.scope.editorChord"]);
    assert.deepEqual(byId("test.scope.editor").bindingConflicts.E, ["test.scope.app"]);
    assert.deepEqual(byId("test.scope.editorChord").bindingConflicts["E+MOUSE2"], [
      "test.scope.appAlternate",
    ]);
  } finally {
    for (const dispose of disposers) {
      dispose();
    }
    category.dispose();
  }
});
