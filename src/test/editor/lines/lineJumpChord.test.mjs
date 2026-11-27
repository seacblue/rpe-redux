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
  advancePrefixSequence,
  createPrefixSequenceState,
} from "../../../core/shortcuts/prefixSequence.ts";
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

test("Ctrl prefix accumulates physical digit tokens and submits them on release", () => {
  let state = createPrefixSequenceState();
  state = advancePrefixSequence(
    state,
    { type: "keydown", event: { key: "Control", code: "ControlLeft", ctrlKey: true } },
    "CTRL",
  ).state;
  for (const digit of ["0", "0", "7"]) {
    const transition = advancePrefixSequence(
      state,
      { type: "keydown", event: { key: digit, code: `Digit${digit}`, ctrlKey: true } },
      "CTRL",
    );
    assert.equal(transition.handled, true);
    state = transition.state;
  }

  const released = advancePrefixSequence(
    state,
    { type: "keyup", event: { key: "Control", code: "ControlLeft" } },
    "CTRL",
  );
  assert.deepEqual(released.submission, {
    kind: "tokens",
    tokens: ["DIGIT0", "DIGIT0", "DIGIT7"],
  });
  assert.deepEqual(released.state, createPrefixSequenceState());
});

test("empty, modified, repeated, and oversized input never becomes an accidental jump", () => {
  const empty = advancePrefixSequence(
    advancePrefixSequence(
      createPrefixSequenceState(),
      { type: "keydown", event: { key: "Control", ctrlKey: true } },
      "CTRL",
    ).state,
    { type: "keyup", event: { key: "Control" } },
    "CTRL",
  );
  assert.deepEqual(empty.submission, { kind: "empty" });

  const modified = advancePrefixSequence(
    advancePrefixSequence(
      createPrefixSequenceState(),
      { type: "keydown", event: { key: "Control", ctrlKey: true } },
      "CTRL",
    ).state,
    { type: "keydown", event: { key: "1", code: "Digit1", ctrlKey: true, shiftKey: true } },
    "CTRL",
  );
  assert.equal(modified.state.active, false);
  assert.equal(modified.handled, false);

  let state = advancePrefixSequence(
    createPrefixSequenceState(),
    { type: "keydown", event: { key: "Control", ctrlKey: true } },
    "CTRL",
  ).state;
  for (let index = 0; index < 7; index += 1) {
    state = advancePrefixSequence(
      state,
      { type: "keydown", event: { key: "1", code: "Digit1", ctrlKey: true } },
      "CTRL",
    ).state;
  }
  const oversized = advancePrefixSequence(
    state,
    { type: "keyup", event: { key: "Control" } },
    "CTRL",
  );
  assert.deepEqual(oversized.submission, { kind: "invalid" });
});

test("the prefix sequence is not coupled to numeric input", () => {
  let state = advancePrefixSequence(
    createPrefixSequenceState(),
    { type: "keydown", event: { key: "Control", ctrlKey: true } },
    "CTRL",
  ).state;
  state = advancePrefixSequence(
    state,
    { type: "keydown", event: { key: "a", code: "KeyA", ctrlKey: true } },
    "CTRL",
  ).state;
  const released = advancePrefixSequence(
    state,
    { type: "keyup", event: { key: "Control" } },
    "CTRL",
  );
  assert.deepEqual(released.submission, { kind: "tokens", tokens: ["A"] });
});

test("a caller can restrict the generic sequence to physical digit tokens", () => {
  const digitToken = (event) => {
    const key = event.code?.startsWith("Numpad")
      ? `NUMPAD${event.code.slice("Numpad".length)}`
      : event.code?.startsWith("Digit")
        ? `DIGIT${event.code.slice("Digit".length)}`
        : null;
    return key && /^(?:DIGIT|NUMPAD)[0-9]$/.test(key) ? key : null;
  };
  let state = advancePrefixSequence(
    createPrefixSequenceState(),
    { type: "keydown", event: { key: "Control", ctrlKey: true } },
    "CTRL",
    digitToken,
  ).state;
  state = advancePrefixSequence(
    state,
    { type: "keydown", event: { key: "1", code: "Numpad1", ctrlKey: true } },
    "CTRL",
    digitToken,
  ).state;
  const released = advancePrefixSequence(
    state,
    { type: "keyup", event: { key: "Control" } },
    "CTRL",
    digitToken,
  );
  assert.deepEqual(released.submission, { kind: "tokens", tokens: ["NUMPAD1"] });
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
