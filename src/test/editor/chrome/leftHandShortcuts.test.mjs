/** The editor's default bindings keep its primary loop under the left hand. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EDITOR_SHORTCUTS,
  matchEditorShortcut,
  registerEditorShortcuts,
} from "../../../core/edit/shortcuts/shortcutCatalog.ts";
import { resolveEditorShortcutArea } from "../../../core/edit/operations/keyboard.ts";

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
  assert.equal(bindingOf("sampling.apply"), "F");
});

test("redo keeps the Ctrl+Y alternative used by the curve draft and RPE migration", () => {
  assert.equal(bindingOf("edit.redo"), "CTRL+Shift+Z");
  assert.equal(bindingOf("edit.redo", 1), "CTRL+Y");
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
});

test("time nudges keep only the arrow pair and G/B stick events", () => {
  assert.equal(bindingOf("selection.nudge.up"), "UPARROW");
  assert.equal(bindingOf("selection.nudge.down"), "DOWNARROW");
  assert.equal(byId.get("selection.nudge.up")?.defaults.length, 1);
  assert.equal(byId.get("selection.nudge.down")?.defaults.length, 1);
  assert.equal(bindingOf("selection.event.stick.next"), "G");
  assert.equal(bindingOf("selection.event.stick.previous"), "B");
  assert.equal(bindingOf("selection.event.toggleHooked"), "F");
});

test("event-edge defaults have left-hand chords before the brackets", () => {
  assert.equal(bindingOf("selection.event.start.earlier"), "Alt+B");
  assert.equal(bindingOf("selection.event.start.later"), "Alt+T");
  assert.equal(bindingOf("selection.event.end.earlier"), "Alt+Shift+B");
  assert.equal(bindingOf("selection.event.end.later"), "Alt+Shift+T");
  assert.equal(bindingOf("selection.event.start.earlier", 1), "LEFTBRACKET");
});

test("R follows the hovered timeline while Q places a Tap or anchor event", () => {
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
    for (const key of ["Q", "W", "E", "R"]) {
      assert.equal(
        matchEditorShortcut({ key }, { area: "notes", hasSelection: false }, shortcutContext),
        key === "Q"
          ? "note.place.tap"
          : key === "W"
            ? "note.place.drag"
            : key === "E"
              ? "note.place.flick"
              : "note.place.hold",
      );
      assert.equal(
        matchEditorShortcut({ key }, { area: "events", hasSelection: false }, shortcutContext),
        key === "R" ? "event.place" : key === "Q" ? "note.place.tap" : undefined,
      );
    }
  } finally {
    dispose();
  }
});

test("hovered timeline area takes precedence over the focused canvas", () => {
  assert.equal(resolveEditorShortcutArea("notes", "events", "notes", "notes"), "events");
  assert.equal(resolveEditorShortcutArea("events", undefined, "notes", "notes"), "events");
  assert.equal(resolveEditorShortcutArea(undefined, undefined, "events", "notes"), "events");
  assert.equal(resolveEditorShortcutArea(undefined, undefined, undefined, "notes"), "notes");
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
      matchEditorShortcut({ key: "G" }, eventContext, shortcutContext),
      "selection.event.stick.next",
    );
    assert.equal(
      matchEditorShortcut({ key: "F" }, eventContext, shortcutContext),
      "selection.event.toggleHooked",
    );
    assert.equal(
      matchEditorShortcut({ key: "F" }, { ...eventContext, samplingActive: true }, shortcutContext),
      undefined,
    );
    assert.equal(
      matchEditorShortcut({ key: "B" }, eventContext, shortcutContext),
      "selection.event.stick.previous",
    );
    // G/B do not stand in for the arrow nudges any more.
    assert.equal(
      matchEditorShortcut({ key: "G" }, { area: "notes", hasSelection: true }, shortcutContext),
      undefined,
    );
    assert.equal(
      matchEditorShortcut(
        { key: "ArrowUp" },
        { area: "events", hasSelection: true },
        shortcutContext,
      ),
      "selection.nudge.up",
    );
  } finally {
    dispose();
  }
});
