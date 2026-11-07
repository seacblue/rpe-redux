/**
 * Editor region visibility: multi-line editing keeps one authoring field at a
 * time, but its own region switch can still hide that field and leave the
 * preview as the workspace fallback.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { displayValues } from "../../../frontend/screens/settings/editorDisplaySettings.ts";
import {
  createEditorViewControls,
  getEditorRegionSnapshot,
  previewVisibleForRegions,
} from "../../../frontend/screens/editor/workspace/runtime/commands/viewControls.ts";
import {
  editorMultiLineActive,
  editorMultiLineMode,
} from "../../../core/edit/state/publishedValues.ts";

// The view controls redraw through a window resize event; Node has no window.
if (typeof globalThis.window === "undefined") {
  globalThis.window = { dispatchEvent() {} };
}

/** Reset the shared display values and enter multi-line editing in one mode. */
function activateMultiLine(mode = "notes") {
  editorMultiLineActive.set(false);
  displayValues.showNotes.set(true);
  displayValues.showEvents.set(true);
  displayValues.previewEnabled.set(true);
  editorMultiLineMode.set(mode);
  editorMultiLineActive.set(true);
}

/** A session stub whose mode write mirrors the published value. */
function createSession(multiLineActive = true) {
  return {
    multiLineActive,
    multiLineMode: "notes",
    setMultiLineMode(mode) {
      this.multiLineMode = mode;
      editorMultiLineMode.set(mode);
    },
  };
}

/** The runtime surface the view controls touch. */
function createRuntime(session) {
  return {
    realtimePreview: { visible: true, showGameUI: false },
    applyDisplaySettings() {},
    persist() {},
    invalidate() {},
    getSession: () => session,
    setRealtimePreviewEnabled(enabled) {
      displayValues.previewEnabled.set(enabled);
    },
  };
}

after(() => {
  editorMultiLineActive.set(false);
});

test("the active multi-line field can hide itself and leave the preview fallback", () => {
  activateMultiLine("notes");
  const controls = createEditorViewControls(createRuntime(createSession()));

  assert.equal(getEditorRegionSnapshot().showNotes, true);
  controls.toggleRegion("showNotes");

  const regions = getEditorRegionSnapshot();
  assert.equal(regions.showNotes, false);
  assert.equal(regions.showEvents, false);
  assert.equal(previewVisibleForRegions(regions), true);
});

test("pressing the other multi-line region switches fields and enables that field", () => {
  activateMultiLine("notes");
  const session = createSession();
  const controls = createEditorViewControls(createRuntime(session));

  controls.toggleRegion("showNotes");
  controls.toggleRegion("showEvents");

  assert.equal(session.multiLineMode, "events");
  assert.equal(getEditorRegionSnapshot().showEvents, true);
  assert.equal(getEditorRegionSnapshot().showNotes, false);

  controls.toggleRegion("showEvents");
  assert.equal(getEditorRegionSnapshot().showEvents, false);
  assert.equal(previewVisibleForRegions(getEditorRegionSnapshot()), true);
});

test("switching multi-line mode reveals a field whose switch was off", () => {
  activateMultiLine("notes");
  displayValues.showEvents.set(false);

  editorMultiLineMode.set("events");

  assert.equal(displayValues.showEvents.get(), true);
  assert.equal(getEditorRegionSnapshot().showEvents, true);
});

test("preview-only restores the complete layout after rapid region changes", () => {
  activateMultiLine();
  editorMultiLineActive.set(false);
  const clock = { value: 100 };
  const controls = createEditorViewControls(createRuntime(createSession(false)), {
    now: () => clock.value,
  });

  controls.toggleRegion("showNotes");
  clock.value = 200;
  controls.toggleRegion("showEvents");
  controls.togglePreviewOnly();

  assert.equal(displayValues.showNotes.get(), true);
  assert.equal(displayValues.showEvents.get(), true);
  assert.equal(displayValues.previewEnabled.get(), true);
  assert.equal(getEditorRegionSnapshot().showPreview, true);
});

test("preview-only overlays the recorded layout without rewriting its switches", () => {
  activateMultiLine();
  editorMultiLineActive.set(false);
  const controls = createEditorViewControls(createRuntime(createSession(false)));

  controls.togglePreviewOnly();

  assert.equal(displayValues.showNotes.get(), true);
  assert.equal(displayValues.showEvents.get(), true);
  assert.equal(displayValues.previewEnabled.get(), true);
  assert.equal(getEditorRegionSnapshot().showNotes, false);
  assert.equal(getEditorRegionSnapshot().showEvents, false);
  assert.equal(getEditorRegionSnapshot().showPreview, true);

  controls.togglePreviewOnly();

  assert.equal(displayValues.showNotes.get(), true);
  assert.equal(displayValues.showEvents.get(), true);
  assert.equal(displayValues.previewEnabled.get(), true);
  assert.equal(getEditorRegionSnapshot().showNotes, true);
  assert.equal(getEditorRegionSnapshot().showEvents, true);
});

test("preview-only restores the last complete layout from an empty raw layout", () => {
  activateMultiLine();
  editorMultiLineActive.set(false);
  const controls = createEditorViewControls(createRuntime(createSession(false)));

  controls.toggleRegions();
  controls.toggleStagePreview();
  controls.togglePreviewOnly();

  assert.equal(displayValues.showNotes.get(), true);
  assert.equal(displayValues.showEvents.get(), true);
  assert.equal(displayValues.previewEnabled.get(), true);
});

test("two preview-only shortcuts return to a newly completed layout", () => {
  activateMultiLine();
  editorMultiLineActive.set(false);
  displayValues.showNotes.set(false);
  const clock = { value: 100 };
  const controls = createEditorViewControls(createRuntime(createSession(false)), {
    now: () => clock.value,
  });

  controls.toggleRegion("showNotes");
  clock.value = 200;
  controls.togglePreviewOnly();
  clock.value = 300;
  controls.togglePreviewOnly();

  assert.equal(displayValues.showNotes.get(), true);
  assert.equal(displayValues.showEvents.get(), true);
  assert.equal(displayValues.previewEnabled.get(), true);
  assert.equal(getEditorRegionSnapshot().showPreview, true);
});
