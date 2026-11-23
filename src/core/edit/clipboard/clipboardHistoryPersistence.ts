/**
 * Persists the app-private clipboard through the preference store.
 *
 * Writes are serialized so a burst of copy operations cannot reorder the
 * stored list; restore and write failures are reported to the caller.
 */
import {
  PREFERENCE_SECTIONS,
  preferences,
  readPreference,
  writePreference,
} from "../../state/preferences.ts";
import type { EditorSession } from "../session/session.ts";
import { t } from "../../../i18n/index.ts";
import type { ClipboardHistory, ClipboardHistoryChangeEvent } from "./clipboardHistory.ts";

/** Pull interval for clipboard changes made by another frontend instance. */
const CLIPBOARD_SYNC_INTERVAL_MS = 1000;
/** Minimum interval between notices about clipboard content from elsewhere. */
export const EXTERNAL_CLIPBOARD_NOTICE_INTERVAL_MS = 10_000;

/** Creates a rate limiter for notices about externally received clipboard data. */
export function createExternalClipboardNoticeGate(
  now: () => number = () => Date.now(),
): () => boolean {
  let lastNoticeAt = Number.NEGATIVE_INFINITY;
  return () => {
    const current = now();
    if (current - lastNoticeAt < EXTERNAL_CLIPBOARD_NOTICE_INTERVAL_MS) {
      return false;
    }
    lastNoticeAt = current;
    return true;
  };
}

/** Restores saved entries and writes later changes in order; returns the unsubscribe. */
export function bindClipboardHistoryPersistence(
  history: ClipboardHistory,
  report: (message: string) => void,
  options: {
    session: () => EditorSession;
    invalidate: () => void;
    onExternalClipboard?: () => void;
  },
): () => void {
  let pending: Promise<unknown> = Promise.resolve();
  const allowExternalClipboardNotice = createExternalClipboardNoticeGate();
  const hasClipboard = () => history.current.notes.length + history.current.events.length > 0;
  const notifyExternalClipboard = () => {
    if (hasClipboard() && allowExternalClipboardNotice()) {
      options.onExternalClipboard?.();
    }
  };
  /** Reads a display message from an unknown failure. */
  const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));
  /** Queues a serialized write for persistable history changes. */
  const changed = (event: Event) => {
    if (!(event as ClipboardHistoryChangeEvent).persist) {
      return;
    }
    const state = history.persistenceState();
    pending = pending
      .then(() => writePreference(PREFERENCE_SECTIONS.clipboard, state))
      .catch((error) =>
        report(t("editor.app.notice.clipboardHistorySaveFailed", { message: failure(error) })),
      );
  };
  history.addEventListener("change", changed);
  const adopt = () => {
    if (history.adopt(readPreference(PREFERENCE_SECTIONS.clipboard, []))) {
      history.attach(options.session());
      options.invalidate();
      notifyExternalClipboard();
    }
  };
  const unsubscribe = preferences.subscribe(PREFERENCE_SECTIONS.clipboard, adopt);
  const refreshTimer = setInterval(() => {
    void preferences.refresh([PREFERENCE_SECTIONS.clipboard]);
  }, CLIPBOARD_SYNC_INTERVAL_MS);
  try {
    history.restore(readPreference(PREFERENCE_SECTIONS.clipboard, []) ?? []);
    history.attach(options.session());
    notifyExternalClipboard();
  } catch (error) {
    report(t("editor.app.notice.clipboardHistoryLoadFailed", { message: failure(error) }));
  }
  return () => {
    history.removeEventListener("change", changed);
    unsubscribe();
    clearInterval(refreshTimer);
  };
}
