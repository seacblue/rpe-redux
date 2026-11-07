/**
 * Binds selection clipboard operations to their session and timeline targets.
 *
 * The owner resolves the target line and beat when the operation runs and
 * remembers successful copies in the clipboard history, keeping panel state and
 * action routing out of the clipboard operations themselves.
 */
import type { EditorSession } from "../session/session.ts";
import type { ClipboardHistory } from "./clipboardHistory.ts";
import {
  copyObjects,
  copyObjectsAllLayers,
  cutObjects,
  deleteObjects,
  pasteObjects,
} from "./operations.ts";

export interface SelectionClipboardDependencies {
  session(): EditorSession;
  targetLine(): number;
  targetBeat(): number;
  clipboardMode(): { mirror?: boolean; keepTime?: boolean };
  setClipboardMode(mode: { mirror?: boolean; keepTime?: boolean }): void;
  history: Pick<ClipboardHistory, "remember">;
  notify(message: string, severity?: string): void;
  copiedMessage(count: number): string;
  invalidate(): void;
}

export interface SelectionClipboardMode {
  mirror?: boolean;
  keepTime?: boolean;
  targetLineIndex?: number;
}

/** Keeps selection clipboard commands and their timeline targeting in one owner. */
export function createSelectionClipboard(deps: SelectionClipboardDependencies) {
  const session = () => deps.session();
  const targetLine = deps.targetLine;

  /** Copies the current selection and records it in clipboard history. */
  function copy(): number {
    const currentSession = session();
    const count = copyObjects(currentSession);
    if (count) {
      deps.history.remember(currentSession);
      deps.notify(deps.copiedMessage(count), "success");
    }
    deps.invalidate();
    return count;
  }

  /** Copies the selected event types across every base layer in their span. */
  function copyAllLayers(): number {
    const currentSession = session();
    const count = copyObjectsAllLayers(currentSession);
    if (count) {
      deps.history.remember(currentSession);
      deps.notify(deps.copiedMessage(count), "success");
    }
    deps.invalidate();
    return count;
  }

  /** Cuts the current selection and records the removed content in history. */
  function cut(): number {
    const currentSession = session();
    const count = cutObjects(currentSession);
    if (count) {
      deps.history.remember(currentSession);
    }
    deps.invalidate();
    return count;
  }

  /** Deletes the current selection without touching clipboard history. */
  function remove(): number {
    const count = deleteObjects(session());
    deps.invalidate();
    return count;
  }

  /** Pastes at a beat, defaulting the target line from the active one. */
  function pasteAt(beat: number, options: SelectionClipboardMode = deps.clipboardMode()): boolean {
    const { targetLineIndex = targetLine(), ...clipboardMode } = options;
    return pasteObjects(session(), beat, { ...clipboardMode, targetLineIndex });
  }

  /** Pastes at the session target beat, optionally preserving source times. */
  function paste(options: SelectionClipboardMode = {}): boolean {
    deps.setClipboardMode(options);
    return pasteAt(deps.targetBeat(), deps.clipboardMode());
  }

  return { targetLine, copy, copyAllLayers, cut, remove, paste, pasteAt };
}
