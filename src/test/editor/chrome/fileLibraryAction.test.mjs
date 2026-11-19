/**
 * The File menu's library action goes through the shared library confirmation.
 *
 * Every other way back to the library - the title-bar brand, the workspace
 * shortcut and route history - asks with the one composable leave-editor
 * prompt. The File action must reach that same command instead of running its
 * own document-close prompt.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { registerFileActions } from "../../../frontend/chrome/topbar/actions/fileActions.ts";
import { bindEditorChromeCommands } from "../../../frontend/contracts/editorCommands.ts";
import { toolbar } from "../../../core/shell/registries/toolbar.ts";

/** A chrome command seam that records which document and navigation verb ran. */
function recordingCommands(calls) {
  return {
    documents: {
      newDocument: () => calls.push("new"),
      openDocument: () => calls.push("open"),
      saveDocument: () => calls.push("save"),
    },
    transport: {
      togglePlayback: () => calls.push("play"),
      beginAudition: () => calls.push("audition-start"),
      endAudition: () => calls.push("audition-end"),
      rewind: () => calls.push("rewind"),
      seekToBeat: (beat) => calls.push(`seek:${beat}`),
    },
    view: {
      isPreviewLayout: () => false,
      resetCamera: () => calls.push("camera"),
      togglePreviewOnly: () => calls.push("preview-only"),
      toggleRegion: (region) => calls.push(region),
      toggleStagePreview: () => calls.push("stage-preview"),
      toggleRegions: () => calls.push("regions"),
    },
    navigation: {
      openLibrary: () => calls.push("open-library"),
      closeLibrary: () => calls.push("close-library"),
    },
    inspector: { openPane: () => false },
  };
}

test("the File library action runs the shared library confirmation", () => {
  const disposers = registerFileActions();
  const calls = [];
  const dispose = bindEditorChromeCommands(recordingCommands(calls));
  try {
    const action = toolbar.node("document.close");
    assert.ok(action, "the File menu must register document.close");
    assert.equal(typeof action.run, "function");
    action.run();
    assert.deepEqual(calls, ["close-library"]);
  } finally {
    dispose();
    disposers.forEach((remove) => remove());
  }
});
