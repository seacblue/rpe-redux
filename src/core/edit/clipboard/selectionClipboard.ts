/**
 * Binds selection clipboard operations to their session and timeline targets.
 *
 * The owner resolves the target line and beat when the operation runs and
 * writes successful copies to the system clipboard, keeping host permissions
 * and action routing out of the clipboard operations themselves.
 */
import type { EditorSession } from "../session/session.ts";
import type { Beat } from "../../global/chart/timing/beat.ts";
import {
  attachClipboardSnapshot,
  clipboardSnapshot,
  clipboardSnapshotKey,
  parseClipboardSnapshot,
  serializeClipboardSnapshot,
  type SystemClipboard,
} from "./clipboardFormat.ts";
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
  targetBeat(): number | Beat;
  clipboardMode(): { mirror?: boolean; keepTime?: boolean };
  setClipboardMode(mode: { mirror?: boolean; keepTime?: boolean }): void;
  systemClipboard?: SystemClipboard | null;
  notify(message: string, severity?: string): void;
  copiedMessage(count: number): string;
  clipboardReadFailed(message: string): string;
  clipboardWriteFailed(message: string): string;
  clipboardReceived(): string;
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
  let observedKey: string | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let pendingWrite: Promise<void> = Promise.resolve();

  /** Turns an unknown failure into a display-safe diagnostic message. */
  const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));

  /** Writes the active selection clipboard as JSON without blocking the edit. */
  function writeSystemClipboard(): void {
    const systemClipboard = deps.systemClipboard;
    if (!systemClipboard) {
      return;
    }
    const snapshot = clipboardSnapshot(session());
    const text = serializeClipboardSnapshot(snapshot);
    observedKey = clipboardSnapshotKey(snapshot);
    pendingWrite = pendingWrite
      .then(() => systemClipboard.writeText(text))
      .catch((error) => {
        deps.notify(deps.clipboardWriteFailed(failure(error)), "error");
      });
  }

  /** Reads a new RPE Redux payload and installs it in the current session. */
  async function refreshFromSystem(showNotice: boolean, reportFailure = false): Promise<boolean> {
    const systemClipboard = deps.systemClipboard;
    if (!systemClipboard) {
      return false;
    }
    let text: string;
    try {
      text = await systemClipboard.readText();
    } catch (error) {
      // Clipboard reads can be denied outside a user gesture; polling retries
      // later and paste reports the failure only when it has a useful message.
      if (reportFailure) {
        deps.notify(deps.clipboardReadFailed(failure(error)), "error");
      }
      return false;
    }
    const snapshot = parseClipboardSnapshot(text);
    if (!snapshot) {
      observedKey = null;
      return false;
    }
    const key = clipboardSnapshotKey(snapshot);
    const currentKey = clipboardSnapshotKey(clipboardSnapshot(session()));
    if (key === currentKey) {
      observedKey = key;
      return false;
    }
    const changedExternally = key !== observedKey;
    observedKey = key;
    attachClipboardSnapshot(session(), snapshot);
    deps.invalidate();
    if (showNotice && changedExternally) {
      deps.notify(deps.clipboardReceived(), "info");
    }
    return true;
  }

  /** Starts silent startup loading and later polling of the system clipboard. */
  function startSystemSync(): () => void {
    if (!deps.systemClipboard) {
      return () => {};
    }
    void refreshFromSystem(false);
    refreshTimer = setInterval(() => {
      void refreshFromSystem(true);
    }, 1000);
    return () => {
      if (refreshTimer !== null) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    };
  }

  /** Copies the current selection and publishes it as system clipboard JSON. */
  function copy(): number {
    const currentSession = session();
    const count = copyObjects(currentSession);
    if (count) {
      writeSystemClipboard();
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
      writeSystemClipboard();
      deps.notify(deps.copiedMessage(count), "success");
    }
    deps.invalidate();
    return count;
  }

  /** Cuts the current selection and publishes the removed content as JSON. */
  function cut(): number {
    const currentSession = session();
    const count = cutObjects(currentSession);
    if (count) {
      writeSystemClipboard();
    }
    deps.invalidate();
    return count;
  }

  /** Deletes the current selection without changing the system clipboard. */
  function remove(): number {
    const count = deleteObjects(session());
    deps.invalidate();
    return count;
  }

  /** Pastes at a beat, defaulting the target line from the active one. */
  function pasteAt(
    beat: number | Beat,
    options: SelectionClipboardMode = deps.clipboardMode(),
  ): boolean {
    const { targetLineIndex = targetLine(), ...clipboardMode } = options;
    return pasteObjects(session(), beat, { ...clipboardMode, targetLineIndex });
  }

  /** Pastes at the session target beat, optionally preserving source times. */
  function paste(options: SelectionClipboardMode = {}): boolean {
    void (async () => {
      await refreshFromSystem(true, true);
      deps.setClipboardMode(options);
      pasteAt(deps.targetBeat(), deps.clipboardMode());
    })();
    return true;
  }

  /** Clears the current selection clipboard and the system text clipboard. */
  function clearClipboard(): void {
    const currentSession = session();
    attachClipboardSnapshot(currentSession, {
      notes: [],
      noteLines: [],
      events: [],
      eventLines: [],
    });
    observedKey = null;
    if (deps.systemClipboard) {
      pendingWrite = pendingWrite
        .then(() => deps.systemClipboard?.writeText("") ?? Promise.resolve())
        .catch((error) => {
          deps.notify(deps.clipboardWriteFailed(failure(error)), "error");
        });
    }
    deps.invalidate();
  }

  return {
    targetLine,
    copy,
    copyAllLayers,
    cut,
    remove,
    paste,
    pasteAt,
    clearClipboard,
    refreshFromSystem,
    startSystemSync,
  };
}
