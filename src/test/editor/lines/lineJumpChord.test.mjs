/** Covers the Ctrl-prefix judge-line gesture and its passive shortcut binding. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EDITOR_SHORTCUTS,
  matchEditorShortcut,
  registerEditorShortcuts,
} from "../../../core/edit/shortcuts/shortcutCatalog.ts";
import { released } from "../../../core/shortcuts/keyMatching.ts";
import {
  advancePrefixDigitSequence,
  createPrefixDigitSequenceState,
} from "../../../core/shortcuts/prefixDigitSequence.ts";
import {
  advanceShortcutCapture,
  createShortcutCaptureState,
} from "../../../frontend/screens/settings/shortcuts/shortcutCapture.ts";

const shortcutContext = {
  atHome: false,
  documentOpen: true,
  modal: "none",
  capturing: false,
  developerMode: false,
  textEntry: false,
  surface: null,
};

const editorContext = {
  area: "notes",
  hasSelection: false,
  hasEventSelection: false,
  samplingActive: false,
};

test("Ctrl prefix accumulates digits and submits a zero-based line index on release", () => {
  let state = createPrefixDigitSequenceState();
  state = advancePrefixDigitSequence(
    state,
    { type: "keydown", event: { key: "Control", code: "ControlLeft", ctrlKey: true } },
    "CTRL",
  ).state;
  for (const digit of ["0", "0", "7"]) {
    const transition = advancePrefixDigitSequence(
      state,
      { type: "keydown", event: { key: digit, code: `Digit${digit}`, ctrlKey: true } },
      "CTRL",
    );
    assert.equal(transition.handled, true);
    state = transition.state;
  }

  const released = advancePrefixDigitSequence(
    state,
    { type: "keyup", event: { key: "Control", code: "ControlLeft" } },
    "CTRL",
  );
  assert.deepEqual(released.submission, { kind: "number", value: 7 });
  assert.deepEqual(released.state, createPrefixDigitSequenceState());
});

test("empty, modified, repeated, and oversized input never becomes an accidental jump", () => {
  const empty = advancePrefixDigitSequence(
    advancePrefixDigitSequence(
      createPrefixDigitSequenceState(),
      { type: "keydown", event: { key: "Control", ctrlKey: true } },
      "CTRL",
    ).state,
    { type: "keyup", event: { key: "Control" } },
    "CTRL",
  );
  assert.deepEqual(empty.submission, { kind: "empty" });

  const modified = advancePrefixDigitSequence(
    advancePrefixDigitSequence(
      createPrefixDigitSequenceState(),
      { type: "keydown", event: { key: "Control", ctrlKey: true } },
      "CTRL",
    ).state,
    { type: "keydown", event: { key: "1", code: "Digit1", ctrlKey: true, shiftKey: true } },
    "CTRL",
  );
  assert.equal(modified.state.active, false);
  assert.equal(modified.handled, false);

  let state = advancePrefixDigitSequence(
    createPrefixDigitSequenceState(),
    { type: "keydown", event: { key: "Control", ctrlKey: true } },
    "CTRL",
  ).state;
  for (let index = 0; index < 7; index += 1) {
    state = advancePrefixDigitSequence(
      state,
      { type: "keydown", event: { key: "1", code: "Digit1", ctrlKey: true } },
      "CTRL",
    ).state;
  }
  const oversized = advancePrefixDigitSequence(
    state,
    { type: "keyup", event: { key: "Control" } },
    "CTRL",
  );
  assert.deepEqual(oversized.submission, { kind: "invalid" });
});

test("bare Ctrl is recordable, releasable, and passive in the normal dispatcher", () => {
  const lineJump = EDITOR_SHORTCUTS.find((shortcut) => shortcut.id === "navigation.line.jump");
  assert.deepEqual(lineJump?.defaults, [{ key: "CTRL" }]);
  assert.equal(lineJump?.passive, true);
  assert.equal(
    released({ key: "Control", code: "ControlLeft" }, { key: "CTRL", modifiers: [] }),
    true,
  );

  let capture = advanceShortcutCapture(createShortcutCaptureState(), {
    type: "keydown",
    event: { key: "Control", code: "ControlLeft", ctrlKey: true },
  });
  capture = advanceShortcutCapture(capture.state, {
    type: "keyup",
    event: { key: "Control", code: "ControlLeft" },
  });
  assert.deepEqual(capture.commit, { key: "CTRL", modifiers: [] });

  const dispose = registerEditorShortcuts();
  try {
    assert.equal(
      matchEditorShortcut(
        { key: "Control", code: "ControlLeft", ctrlKey: true },
        editorContext,
        shortcutContext,
      ),
      undefined,
    );
  } finally {
    dispose();
  }
});
