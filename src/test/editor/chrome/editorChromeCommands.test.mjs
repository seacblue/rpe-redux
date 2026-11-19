/** The chrome command seam publishes one editor binding and clears it cleanly. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  bindEditorChromeCommands,
  editorChromeCommands,
} from "../../../frontend/contracts/editorCommands.ts";

test("chrome commands are absent until bound and cleared by their disposer", () => {
  assert.equal(editorChromeCommands(), null);
  const calls = [];
  const dispose = bindEditorChromeCommands({
    documents: {
      newDocument: () => calls.push("new"),
      openDocument: () => calls.push("open"),
      saveDocument: () => calls.push("save"),
    },
    transport: {
      togglePlayback: () => calls.push("play"),
      beginAudition: (options) => calls.push(`audition-start:${options?.previewOnly === true}`),
      endAudition: () => calls.push("audition-end"),
      rewind: () => calls.push("rewind"),
      seekToBeat: (beat) => calls.push(`seek:${beat}`),
    },
    view: {
      isPreviewLayout: () => true,
      resetCamera: () => calls.push("camera"),
      togglePreviewOnly: () => calls.push("preview-only"),
      toggleRegion: (region) => calls.push(region),
      toggleStagePreview: () => calls.push("stage-preview"),
      toggleRegions: () => calls.push("regions"),
      setTimelineScale: (scale) => calls.push(`timeline-scale:${scale}`),
      commitTimelineScale: () => calls.push("timeline-scale-commit"),
    },
    navigation: {
      openLibrary: () => calls.push("library"),
      closeLibrary: () => calls.push("close-library"),
    },
    inspector: { openPane: (id) => id === "notes" },
  });

  const commands = editorChromeCommands();
  assert.notEqual(commands, null);
  commands.documents.saveDocument();
  commands.transport.togglePlayback();
  commands.transport.beginAudition({ previewOnly: true });
  commands.transport.seekToBeat("4");
  commands.view.toggleRegion("showNotes");
  commands.view.setTimelineScale(750);
  commands.view.commitTimelineScale();
  commands.navigation.openLibrary();
  commands.navigation.closeLibrary();
  assert.equal(commands.view.isPreviewLayout(), true);
  assert.equal(commands.inspector.openPane("notes"), true);
  assert.equal(commands.inspector.openPane("missing"), false);
  assert.deepEqual(calls, [
    "save",
    "play",
    "audition-start:true",
    "seek:4",
    "showNotes",
    "timeline-scale:750",
    "timeline-scale-commit",
    "library",
    "close-library",
  ]);

  dispose();
  assert.equal(editorChromeCommands(), null);
});
