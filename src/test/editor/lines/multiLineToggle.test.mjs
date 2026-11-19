/**
 * The `J` shortcut is a switch: it opens multi-line editing and a second press
 * returns to the ordinary single-line timeline.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createLine } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { runEditorKeyboardAction } from "../../../core/edit/operations/keyboard.ts";
import { leaveMultiLineEditing } from "../../../core/edit/multiLine/multiLineEdit.ts";

/** A chart with three lines so a multi-line selection can hold. */
function chartWithLines() {
  const chart = createChart();
  chart.judgeLineList = [createLine("L0"), createLine("L1"), createLine("L2")];
  return chart;
}

/** The event fields the keyboard action reads for a plain key press. */
function keyEvent() {
  return {
    key: "j",
    code: "KeyJ",
    repeat: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
  };
}

/** Minimal dependencies for the toggle branch; unused entries stay undefined. */
function keyboardDeps(session, opened) {
  return {
    getSession: () => session,
    timeline: { eventInteraction: { pending: null } },
    openMultiLinePanel: () => opened.push(true),
    reportError: (error) => {
      throw error;
    },
  };
}

test("J restores the line list chosen before closing", async () => {
  const session = new EditorSession(chartWithLines());
  session.setMultiLineSelection([0, 1, 2]);
  const opened = [];
  const deps = keyboardDeps(session, opened);

  await runEditorKeyboardAction(keyEvent(), "workspace.multiLine.toggle", "notes", deps);
  assert.equal(session.multiLineActive, false);
  assert.deepEqual(session.multiLineIndices, [session.lineIndex]);
  assert.equal(opened.length, 0);

  await runEditorKeyboardAction(keyEvent(), "workspace.multiLine.toggle", "notes", deps);
  assert.equal(session.multiLineActive, true);
  assert.deepEqual(session.multiLineIndices, [0, 1, 2]);
  assert.deepEqual(session.multiLineTokens, [{ kind: "range", start: 0, end: 2, step: 1 }]);
  assert.equal(opened.length, 1);
});

test("J reopens a kept multi-line list on the edited field", async () => {
  const session = new EditorSession(chartWithLines());
  session.setMultiLineSelection([0, 1, 2]);
  session.multiLineEnabled = false;
  session.focus = "events";
  const opened = [];

  await runEditorKeyboardAction(
    keyEvent(),
    "workspace.multiLine.toggle",
    "notes",
    keyboardDeps(session, opened),
  );

  assert.equal(session.multiLineActive, true);
  assert.equal(session.multiLineMode, "events");
});

test("leaving multi-line editing remembers the list and collapses to the active line", () => {
  const session = new EditorSession(chartWithLines());
  session.setMultiLineSelection([0, 1, 2]);

  leaveMultiLineEditing(session);

  assert.equal(session.multiLineActive, false);
  assert.deepEqual(session.multiLineIndices, [session.lineIndex]);
  assert.deepEqual(session.multiLineRestore, [0, 1, 2]);
  assert.deepEqual(session.multiLineRestoreTokens, [{ kind: "range", start: 0, end: 2, step: 1 }]);
});
