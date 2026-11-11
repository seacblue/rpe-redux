/** Held auditions focus the preview and restore their starting state on release. */
import assert from "node:assert/strict";
import test from "node:test";
import { editorAuditioning } from "../../../core/edit/state/publishedValues.ts";
import { displayValues } from "../../../frontend/screens/settings/editorDisplaySettings.ts";
import {
  connectTransport,
  transport,
} from "../../../frontend/screens/editor/workspace/runtime/commands/transport.ts";
import {
  connectViewControls,
  getEditorRegionSnapshot,
} from "../../../frontend/screens/editor/workspace/runtime/commands/viewControls.ts";
import { runEditorShortcutRelease } from "../../../core/edit/operations/keyboard.ts";

// The view controls redraw through a window resize event; Node has no window.
if (typeof globalThis.window === "undefined") {
  globalThis.window = { dispatchEvent() {} };
}

/** Reset the raw layout and create a playback double that records its position. */
function createAuditionRuntime() {
  displayValues.showNotes.set(true);
  displayValues.showEvents.set(true);
  displayValues.previewEnabled.set(true);
  editorAuditioning.set(false);
  const audio = {
    playing: false,
    rate: 1,
    duration: 100,
    time: 10,
    pause() {
      this.playing = false;
    },
    play() {
      this.playing = true;
      return Promise.resolve();
    },
    seek(seconds) {
      this.playing = false;
      this.time = seconds;
    },
  };
  const playback = {
    audio,
    pause() {
      audio.pause();
    },
    play() {
      return audio.play();
    },
    seek(seconds) {
      audio.seek(seconds);
    },
  };
  const session = { chart: {} };
  return {
    audio,
    transportBindings: {
      togglePlayback: () => Promise.resolve(),
      seekBeat() {},
      playback,
      getSession: () => session,
      invalidate() {},
      reportError(error) {
        throw error;
      },
    },
    viewRuntime: {
      realtimePreview: { visible: true, showGameUI: false },
      applyDisplaySettings() {},
      persist() {},
      invalidate() {},
      getSession: () => session,
      setRealtimePreviewEnabled(enabled) {
        displayValues.previewEnabled.set(enabled);
      },
    },
  };
}

test("a preview audition returns to its starting layout and time", async () => {
  const runtime = createAuditionRuntime();
  const disposeView = connectViewControls(runtime.viewRuntime);
  const disposeTransport = connectTransport(runtime.transportBindings);
  try {
    assert.equal(transport.beginAudition({ previewOnly: true }), true);
    await Promise.resolve();
    assert.equal(runtime.audio.playing, true);
    assert.equal(editorAuditioning.get(), true);
    assert.equal(getEditorRegionSnapshot().showNotes, false);
    assert.equal(getEditorRegionSnapshot().showEvents, false);
    assert.equal(getEditorRegionSnapshot().showPreview, true);

    runtime.audio.time = 15;
    transport.endAudition();

    assert.equal(runtime.audio.playing, false);
    assert.equal(runtime.audio.time, 10);
    assert.equal(editorAuditioning.get(), false);
    assert.equal(getEditorRegionSnapshot().showNotes, true);
    assert.equal(getEditorRegionSnapshot().showEvents, true);
  } finally {
    disposeTransport();
    disposeView();
    editorAuditioning.set(false);
  }
});

test("releasing either preview audition action ends the hold", () => {
  let ended = 0;
  const deps = {
    endPreviewAudition() {
      ended += 1;
    },
  };
  runEditorShortcutRelease("view.previewAudition", deps);
  runEditorShortcutRelease("view.previewAuditionStay", deps);
  runEditorShortcutRelease("view.togglePreviewOnly", deps);
  assert.equal(ended, 2);
});

test("a staying preview audition keeps the release time", async () => {
  const runtime = createAuditionRuntime();
  const disposeView = connectViewControls(runtime.viewRuntime);
  const disposeTransport = connectTransport(runtime.transportBindings);
  try {
    assert.equal(transport.beginAudition({ previewOnly: true, restoreTime: false }), true);
    await Promise.resolve();
    runtime.audio.time = 15;
    transport.endAudition();

    assert.equal(runtime.audio.playing, false);
    assert.equal(runtime.audio.time, 15);
    assert.equal(getEditorRegionSnapshot().showNotes, true);
    assert.equal(getEditorRegionSnapshot().showEvents, true);
  } finally {
    disposeTransport();
    disposeView();
    editorAuditioning.set(false);
  }
});

test("a hold during playback only hides the authoring surfaces", () => {
  const runtime = createAuditionRuntime();
  const disposeView = connectViewControls(runtime.viewRuntime);
  const disposeTransport = connectTransport(runtime.transportBindings);
  try {
    runtime.audio.playing = true;
    runtime.audio.time = 12;
    assert.equal(transport.beginAudition({ previewOnly: true }), true);
    assert.equal(runtime.audio.playing, true);
    assert.equal(runtime.audio.time, 12);
    assert.equal(editorAuditioning.get(), false);
    assert.equal(getEditorRegionSnapshot().showNotes, false);
    assert.equal(getEditorRegionSnapshot().showEvents, false);
    assert.equal(getEditorRegionSnapshot().showPreview, true);

    runtime.audio.time = 16;
    transport.endAudition();

    assert.equal(runtime.audio.playing, true);
    assert.equal(runtime.audio.time, 16);
    assert.equal(getEditorRegionSnapshot().showNotes, true);
    assert.equal(getEditorRegionSnapshot().showEvents, true);
    assert.equal(getEditorRegionSnapshot().showPreview, true);
  } finally {
    disposeTransport();
    disposeView();
    editorAuditioning.set(false);
  }
});

test("a second hold or a non-preview audition is refused while playback runs", () => {
  const runtime = createAuditionRuntime();
  const disposeView = connectViewControls(runtime.viewRuntime);
  const disposeTransport = connectTransport(runtime.transportBindings);
  try {
    runtime.audio.playing = true;
    assert.equal(transport.beginAudition({ previewOnly: false }), false);
    assert.equal(transport.beginAudition({ previewOnly: true }), true);
    assert.equal(transport.beginAudition({ previewOnly: true }), false);
    transport.endAudition();
    assert.equal(runtime.audio.playing, true);
  } finally {
    disposeTransport();
    disposeView();
    editorAuditioning.set(false);
  }
});
