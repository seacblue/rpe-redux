/** Shortcut categories shared by the toolbar and the editor register once. */
import assert from "node:assert/strict";
import test from "node:test";
import { registerEditorShortcuts } from "../../../core/edit/shortcuts/shortcutCatalog.ts";
import { multiLineShortcuts } from "../../../core/edit/multiLine/multiLineEdit.ts";
import { SHORTCUT_CATEGORIES } from "../../../core/shortcuts/categories.ts";
import { ShortcutRegistry, shortcutRegistry } from "../../../core/shortcuts/registry.ts";

test("editor shortcuts reuse a playback category a toolbar action registered first", () => {
  const alreadyRegistered = shortcutRegistry.hasCategory("editor.playback");
  const toolbarRegistration = alreadyRegistered
    ? null
    : shortcutRegistry.registerCategory(SHORTCUT_CATEGORIES.editorPlayback);
  const disposeEditor = registerEditorShortcuts();
  try {
    assert.equal(shortcutRegistry.hasCategory("editor.playback"), true);
  } finally {
    disposeEditor();
    toolbarRegistration?.dispose();
  }
});

test("multi-line editing uses J and K by default", () => {
  const defaults = Object.fromEntries(
    multiLineShortcuts.map((shortcut) => [shortcut.id, shortcut.defaults.map(({ key }) => key)]),
  );
  assert.deepEqual(defaults["workspace.multiLine.toggle"], ["J"]);
  assert.deepEqual(defaults["workspace.multiLine.switchMode"], ["K"]);
});

test("disabled shortcuts do not dispatch or create conflicts", () => {
  const registry = new ShortcutRegistry();
  const category = registry.registerCategory({ id: "test.shortcuts", title: "Test", order: 0 });
  let hidden = false;
  const hiddenDisposer = registry.registerShortcut({
    id: "test.shortcuts.hidden",
    category: category.id,
    title: "Hidden",
    defaults: [{ key: "E", modifiers: ["CTRL", "SHIFT"] }],
    scope: "editor",
    enabled: () => !hidden,
  });
  const visibleDisposer = registry.registerShortcut({
    id: "test.shortcuts.visible",
    category: category.id,
    title: "Visible",
    defaults: [{ key: "E", modifiers: ["CTRL", "SHIFT"] }],
    scope: "editor",
  });
  try {
    hidden = true;
    const disabledViews = registry.shortcuts();
    assert.deepEqual(
      disabledViews.find((view) => view.id === "test.shortcuts.hidden")?.conflicts,
      [],
    );
    assert.equal(
      registry.match({ key: "E", ctrlKey: true, shiftKey: true })?.id,
      "test.shortcuts.visible",
    );

    hidden = false;
    const enabledViews = registry.shortcuts();
    assert.deepEqual(enabledViews.find((view) => view.id === "test.shortcuts.hidden")?.conflicts, [
      "test.shortcuts.visible",
    ]);
    assert.deepEqual(enabledViews.find((view) => view.id === "test.shortcuts.visible")?.conflicts, [
      "test.shortcuts.hidden",
    ]);
  } finally {
    visibleDisposer();
    hiddenDisposer();
    category.dispose();
  }
});
