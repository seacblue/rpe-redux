/**
 * Verifies the curve-note editor releases its anchor pick and preview ghost when
 * its pane closes, and that the Ctrl+click quick pick advances start to end to a
 * new curve without leaving a stale pick mode behind.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createNote } from "../../../core/global/chart/chart.ts";
import { beatValue, fromNumber } from "../../../core/global/chart/timing/beat.ts";
import { createValue } from "../../../core/state/values.ts";
import { createCurveEditor } from "../../../frontend/screens/editor/inspector/curveNotes/curveEditor.ts";
import { EMPTY_CURVE_QUICK } from "../../../frontend/screens/editor/inspector/curveNotes/model.ts";

/** A timeline note at one exact beat and horizontal position. */
function note(beat, positionX, type = 4) {
  return {
    ...createNote(type, beat, positionX),
    startTime: fromNumber(beat),
    endTime: fromNumber(beat),
  };
}

/** Creates a curve editor with no timeline or host side effects. */
function createTestEditor() {
  const fields = createValue({ initial: null });
  const pickMode = createValue({ initial: null });
  const quick = createValue({ initial: EMPTY_CURVE_QUICK });
  const notifications = [];
  let committed = null;
  let invalidations = 0;
  const editor = createCurveEditor({
    state: { fields, pickMode, quick },
    getDivision: () => 4,
    getNotes: () => [],
    setPickMode: pickMode.set,
    activatePane: () => {},
    showSingleNoteTimeline: () => {},
    closePane: () => {},
    invalidate: () => {
      invalidations += 1;
    },
    notify: (message, severity) => {
      notifications.push({ message, severity });
    },
    reportError: () => {},
    commit: (notes) => {
      committed = notes;
    },
  });
  return {
    editor,
    fields,
    pickMode,
    quick,
    notifications,
    committed: () => committed,
    invalidations: () => invalidations,
  };
}

test("deactivating the curve editor cancels an in-progress anchor pick", () => {
  const { editor, pickMode } = createTestEditor();

  editor.capture(false);
  assert.equal(pickMode.get(), "start");
  editor.deactivate();
  assert.equal(pickMode.get(), null);
});

test("deactivating the curve editor drops its preview ghost", () => {
  const { editor, invalidations } = createTestEditor();

  editor.openPanel();
  assert.ok(editor.ghost().length > 0, "an open pane previews its anchors");

  editor.setPreview(false);
  assert.deepEqual(editor.ghost(), [], "the preview toggle hides the ghost");
  editor.setPreview(true);
  assert.ok(editor.ghost().length > 0, "turning the preview back on restores it");

  const before = invalidations();
  editor.deactivate();
  assert.deepEqual(
    editor.ghost(),
    [],
    "leaving the pane drops the ghost even with preview enabled and valid values",
  );
  assert.ok(invalidations() > before, "leaving the pane requests an immediate repaint");
});

test("the first Ctrl+click opens the pane and waits for the end note", () => {
  const { editor, pickMode, quick } = createTestEditor();

  assert.equal(editor.quickPick(note(2, -50), 0, 3), true);
  assert.equal(editor.isOpen, true);
  assert.equal(pickMode.get(), "end");

  const state = quick.get();
  assert.equal(state.visible, false, "the quick panel waits for both notes");
  assert.equal(state.phase, "end");
  assert.deepEqual(state.start?.startTime, [2, 0, 1]);
  assert.equal(state.start?.positionX, -50);
  assert.equal(state.start?.lineIndex, 3);
  assert.equal(state.end, null);
  assert.equal(state.easingType, 1);
});

test("the second Ctrl+click completes the pick and shows the quick panel", () => {
  const { editor, pickMode, quick } = createTestEditor();

  editor.quickPick(note(2, -50), 0, 0);
  assert.equal(editor.quickPick(note(4, 100), 1, 0), true);

  const state = quick.get();
  assert.equal(state.visible, true);
  assert.equal(state.phase, "complete");
  assert.equal(pickMode.get(), null);
  assert.deepEqual(state.end?.startTime, [4, 0, 1]);
  assert.equal(state.end?.positionX, 100);
});

test("the quick type starts from the start note and stays independent of the pane", () => {
  const { editor, quick, fields } = createTestEditor();

  editor.quickPick(note(1, -100, 3), 0, 0);
  editor.quickPick(note(3, 100, 4), 1, 0);
  assert.equal(quick.get().type, 3, "a Flick start note selects Flick");
  assert.equal(fields.get()?.values.type, 4, "the pane keeps its own type");

  editor.setQuickType(1);
  assert.equal(quick.get().type, 1);
  assert.equal(fields.get()?.values.type, 4, "the quick panel never edits the pane");
});

test("a Ctrl+click after a complete pick starts a new curve", () => {
  const { editor, quick } = createTestEditor();

  editor.quickPick(note(1, -10, 4), 0, 0);
  editor.quickPick(note(3, 10, 4), 1, 0);
  editor.quickPick(note(6, 20, 3), 2, 0);

  const state = quick.get();
  assert.equal(state.visible, false, "the new pick hides the panel until its end");
  assert.equal(state.phase, "end");
  assert.deepEqual(state.start?.startTime, [6, 0, 1]);
  assert.equal(state.start?.positionX, 20);
  assert.equal(state.end, null);
  assert.equal(state.type, 3, "the new start note sets the new quick type");
});

test("the quick panel's own type and easing generate the picked anchors", () => {
  const { editor, quick, committed } = createTestEditor();

  editor.quickPick(note(1, -100), 0, 0);
  editor.quickPick(note(2, 100), 1, 0);
  editor.setEasing(7);
  editor.setQuickType(3);
  assert.equal(quick.get().easingType, 7);
  assert.equal(quick.get().type, 3);

  editor.generate();
  const notes = committed();
  assert.ok(notes, "generation commits a note list");
  assert.equal(notes.length, 5, "two anchors and three intermediate notes");
  assert.deepEqual(notes[0].startTime, [1, 0, 1]);
  assert.equal(notes[0].positionX, -100);
  assert.equal(notes[0].type, 3);
  assert.deepEqual(notes.at(-1).startTime, [2, 0, 1]);
  assert.equal(notes.at(-1).positionX, 100);
  assert.equal(notes.at(-1).type, 3);
  assert.equal(editor.isOpen, false, "a successful commit closes the pane");
  assert.equal(quick.get().visible, false);
});

test("generating a later start than end swaps both anchors first", () => {
  const { editor, committed } = createTestEditor();

  editor.quickPick(note(3, 300, 3), 0, 0);
  editor.quickPick(note(1, -100, 4), 1, 0);
  editor.generate();

  const notes = committed();
  assert.ok(notes);
  assert.deepEqual(notes[0].startTime, [1, 0, 1]);
  assert.equal(notes[0].positionX, -100);
  assert.deepEqual(notes.at(-1).startTime, [3, 0, 1]);
  assert.equal(notes.at(-1).positionX, 300);
});

test("a Hold quick curve spans one division on every note", () => {
  const { editor, quick, committed } = createTestEditor();

  editor.quickPick(note(1, -100, 2), 0, 0);
  editor.quickPick(note(2, 100, 2), 1, 0);
  assert.equal(quick.get().type, 2, "a Hold start note selects Hold");
  editor.generate();

  const notes = committed();
  assert.ok(notes);
  for (const generated of notes) {
    assert.equal(generated.type, 2);
    assert.equal(
      beatValue(generated.endTime) - beatValue(generated.startTime),
      0.25,
      "the quick editor's division is four lines per beat",
    );
  }
});

test("generation while the end is still pending warns and commits nothing", () => {
  const { editor, notifications, committed } = createTestEditor();

  editor.quickPick(note(3, 0), 0, 0);
  editor.generate();

  assert.equal(committed(), null);
  assert.equal(notifications.at(-1)?.severity, "warning");
});

test("dismissing the quick panel clears both anchors and the pick mode", () => {
  const { editor, pickMode, quick } = createTestEditor();

  editor.quickPick(note(1, -10), 0, 0);
  editor.quickPick(note(2, 10), 1, 0);
  editor.dismissQuick();

  assert.equal(pickMode.get(), null);
  assert.equal(quick.get().visible, false);
  assert.deepEqual(editor.ghost(), []);
});
