/**
 * The marquee clipboard's four commands, over the selection clipboard the
 * runtime provider constructs.
 */
import { createSelectionClipboard } from "../../../../../../core/edit/clipboard/selectionClipboard.ts";

interface ClipboardCommandsDeps {
  selectionClipboard: ReturnType<typeof createSelectionClipboard>;
}

/** The four clipboard verbs every menu, key and rail button reaches. */
export function createClipboardCommands({ selectionClipboard }: ClipboardCommandsDeps) {
  function copySelection() {
    selectionClipboard.copy();
  }
  function copySelectionAllLayers() {
    selectionClipboard.copyAllLayers();
  }
  function deleteSelection() {
    selectionClipboard.remove();
  }
  function cutSelection() {
    selectionClipboard.cut();
  }
  function pasteSelection(options: { mirror?: boolean; keepTime?: boolean } = {}) {
    selectionClipboard.paste(options);
  }
  return {
    copySelection,
    copySelectionAllLayers,
    deleteSelection,
    cutSelection,
    pasteSelection,
  };
}
