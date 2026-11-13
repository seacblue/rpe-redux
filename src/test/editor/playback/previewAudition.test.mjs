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
import {
  runEditorKeyboardAction,
  runEditorShortcutRelease,
} from "../../../core/edit/operations/keyboard.ts";

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

test("RPE playback keys hide the editor while playing and restore it on stop", async () => {
  const runtime = createAuditionRuntime();
  const disposeView = connectViewControls(runtime.viewRuntime);
  const disposeTransport = connectTransport(runtime.transportBindings);
  try {
    runtime.audio.time = 10;
    transport.startPlayback();
    await Promise.resolve();
    assert.equal(runtime.audio.playing, true);
    assert.equal(getEditorRegionSnapshot().showNotes, false);
    assert.equal(getEditorRegionSnapshot().showEvents, false);

    // The restore key pauses, shows the editor, and returns to the start position.
    runtime.audio.time = 15;
    transport.stopPlayback();
    assert.equal(runtime.audio.playing, false);
    assert.equal(runtime.audio.time, 10);
    assert.equal(getEditorRegionSnapshot().showNotes, true);
    assert.equal(getEditorRegionSnapshot().showEvents, true);

    // Pressed while paused, RPE's restore key starts playback and hides again.
    transport.stopPlayback();
    await Promise.resolve();
    assert.equal(runtime.audio.playing, true);
    assert.equal(getEditorRegionSnapshot().showNotes, false);

    // The stay key shows the editor and pauses at the current position.
    runtime.audio.time = 20;
    transport.stopPlaybackStay();
    assert.equal(runtime.audio.playing, false);
    assert.equal(runtime.audio.time, 20);
    assert.equal(getEditorRegionSnapshot().showNotes, true);

    // Replay seeks to zero, hides the editor, and plays from the beginning.
    transport.replayPlayback();
    await Promise.resolve();
    assert.equal(runtime.audio.playing, true);
    assert.equal(runtime.audio.time, 0);
    assert.equal(getEditorRegionSnapshot().showNotes, false);

    // Leave the shared preview-only value in its editing state for other tests.
    transport.stopPlaybackStay();
  } finally {
    disposeTransport();
    disposeView();
    editorAuditioning.set(false);
  }
});

test("RPE playback and clipboard actions dispatch to their owner", async () => {
  const calls = [];
  const deps = {
    getSession: () => ({}),
    timeline: { eventInteraction: { pending: null }, division: 1, gridCount: 16, eventTypes: [] },
    startPlayback: async () => calls.push("start"),
    stopPlayback: () => calls.push("stop"),
    stopPlaybackStay: () => calls.push("stay"),
    replayPlayback: async () => calls.push("replay"),
    toggleTimeSnap: () => calls.push("snap"),
    pasteSelection: (options) => calls.push(["paste", options]),
    // The keyboard layer routes playback keys to transport callbacks; the
    // playback commands own the preview layout through the view controls.
    beginPreviewAudition: () => calls.push("preview"),
    endPreviewAudition: () => calls.push("preview"),
    togglePreviewOnly: () => calls.push("preview"),
    reportError(error) {
      throw error;
    },
  };
  const event = { key: "I", repeat: false, preventDefault() {}, stopPropagation() {} };
  await runEditorKeyboardAction(event, "playback.start", "notes", deps);
  await runEditorKeyboardAction(event, "playback.stop", "notes", deps);
  await runEditorKeyboardAction(event, "playback.stopStay", "notes", deps);
  await runEditorKeyboardAction(event, "playback.replay", "notes", deps);
  await runEditorKeyboardAction(event, "timeline.toggleSnapX", "notes", deps);
  await runEditorKeyboardAction(event, "edit.paste.keepTimeMirror", "notes", deps);
  assert.deepEqual(calls, [
    "start",
    "stop",
    "stay",
    "replay",
    "snap",
    ["paste", { keepTime: true, mirror: true }],
  ]);
});
