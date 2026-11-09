/** Shortcut categories shared by the toolbar and the editor register once. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EDITOR_SHORTCUTS,
  registerEditorShortcuts,
} from "../../../core/edit/shortcuts/shortcutCatalog.ts";
import { multiLineShortcuts } from "../../../core/edit/multiLine/multiLineEdit.ts";
import {
  SHORTCUT_CATEGORIES,
  compareShortcutCategories,
} from "../../../core/shortcuts/categories.ts";
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

test("built-in categories have one product-wide order", () => {
  const categories = Object.values(SHORTCUT_CATEGORIES).sort(compareShortcutCategories);
  const orders = categories.map((category) => category.order);
  assert.deepEqual(
    orders,
    [...orders].sort((left, right) => left - right),
    "category order must compare as a sequence",
  );
  assert.equal(new Set(orders).size, orders.length, "category order must be unique");
  assert.equal(
    SHORTCUT_CATEGORIES.editorNavigation.order < SHORTCUT_CATEGORIES.editorPlayback.order,
    true,
  );
  assert.equal(SHORTCUT_CATEGORIES.editorCurve.order < SHORTCUT_CATEGORIES.sampling.order, true);
});

test("sampling commands form their own category", () => {
  const sampling = EDITOR_SHORTCUTS.filter(
    (shortcut) =>
      shortcut.id === "sampling.apply" ||
      shortcut.id === "sampling.cancel" ||
      shortcut.id === "sampling.hideGuides" ||
      shortcut.id === "event.sample.start" ||
      shortcut.id === "event.sample.end",
  );
  assert.equal(sampling.length, 5);
  for (const shortcut of sampling) {
    assert.equal(shortcut.category, SHORTCUT_CATEGORIES.sampling.id, shortcut.id);
  }
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
