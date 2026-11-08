/** The editor's default bindings keep its primary loop under the left hand. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EDITOR_SHORTCUTS,
  matchEditorShortcut,
  registerEditorShortcuts,
} from "../../../core/edit/shortcuts/shortcutCatalog.ts";

const byId = new Map(EDITOR_SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));

/** Render one default binding as the token text the shortcut editor shows. */
function bindingOf(id, index = 0) {
  const binding = byId.get(id)?.defaults[index];
  assert.ok(binding, `missing default binding ${id}[${index}]`);
  const modifiers = (binding.modifiers ?? []).map((modifier) =>
    modifier === "ALT" ? "Alt" : modifier === "SHIFT" ? "Shift" : modifier,
  );
  return [...modifiers, binding.key].join("+");
}

test("sampling selected events uses the left-hand V key for both anchors", () => {
  assert.equal(bindingOf("event.sample.start"), "V");
  assert.equal(bindingOf("event.sample.end"), "Shift+V");
});

test("scale and line-move defaults have left-hand chords before the arrows", () => {
  assert.equal(bindingOf("selection.scale.narrower"), "Alt+Z");
  assert.equal(bindingOf("selection.scale.wider"), "Alt+X");
  assert.equal(bindingOf("selection.line.previous"), "Alt+Shift+Z");
  assert.equal(bindingOf("selection.line.next"), "Alt+Shift+X");
  assert.equal(bindingOf("selection.scale.narrower", 1), "Alt+LEFTARROW");
  assert.equal(bindingOf("selection.line.previous", 1), "Alt+UPARROW");
});

test("preview auditions use the held T and U keys", () => {
  assert.equal(bindingOf("view.previewAudition"), "T");
  assert.equal(bindingOf("view.previewAuditionStay"), "U");
  assert.equal(byId.get("view.previewAudition")?.hold, true);
  assert.equal(byId.get("view.previewAuditionStay")?.hold, true);
  assert.equal(bindingOf("selection.nudge.up"), "G");
});

test("event-edge defaults have left-hand chords before the brackets", () => {
  assert.equal(bindingOf("selection.event.start.earlier"), "Alt+B");
  assert.equal(bindingOf("selection.event.start.later"), "Alt+T");
  assert.equal(bindingOf("selection.event.end.earlier"), "Alt+Shift+B");
  assert.equal(bindingOf("selection.event.end.later"), "Alt+Shift+T");
  assert.equal(bindingOf("selection.event.start.earlier", 1), "LEFTBRACKET");
});

test("sampling opener yields to the open sampler and the left-hand chords resolve", () => {
  const dispose = registerEditorShortcuts();
  try {
    const shortcutContext = {
      atHome: false,
      documentOpen: true,
      modal: "none",
      capturing: false,
      developerMode: false,
      textEntry: false,
      surface: null,
    };
    const eventContext = {
      area: "events",
      hasSelection: true,
      hasEventSelection: true,
      samplingActive: false,
    };
    assert.equal(
      matchEditorShortcut({ key: "V" }, eventContext, shortcutContext),
      "event.sample.start",
    );
    assert.equal(
      matchEditorShortcut({ key: "V", shiftKey: true }, eventContext, shortcutContext),
      "event.sample.end",
    );
    assert.equal(
      matchEditorShortcut({ key: "V" }, { ...eventContext, samplingActive: true }, shortcutContext),
      undefined,
    );
    assert.equal(
      matchEditorShortcut(
        { key: "Z", altKey: true },
        { area: "notes", hasSelection: true },
        shortcutContext,
      ),
      "selection.scale.narrower",
    );
    assert.equal(
      matchEditorShortcut(
        { key: "B", altKey: true },
        { area: "events", hasSelection: true },
        shortcutContext,
      ),
      "selection.event.start.earlier",
    );
    assert.equal(
      matchEditorShortcut({ key: "T" }, { area: "notes", hasSelection: true }, shortcutContext),
      "view.previewAudition",
    );
    assert.equal(
      matchEditorShortcut({ key: "G" }, { area: "notes", hasSelection: true }, shortcutContext),
      "selection.nudge.up",
    );
  } finally {
    dispose();
  }
});
