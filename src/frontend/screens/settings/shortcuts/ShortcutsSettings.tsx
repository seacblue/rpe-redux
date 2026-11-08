/**
 * The shortcut editor.
 *
 * One list holds every shortcut a feature registered — the shell's toolbar
 * actions and the editor's key table alike — because the registry is the only
 * place a binding lives. The page never names a command: it renders the
 * categories it finds and, for each row, the bindings the profile answers with.
 *
 * Recording is the page's own transient state: which shortcut and which slot the
 * next key belongs to. A row's key cap records a replacement for that slot; the
 * plus button records an addition. Nothing here writes a key table. The capture
 * dialog keeps its last rendered values while the shared modal fades out, so
 * closing never blanks the text before the dialog disappears.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../../../../design/components/button/Button.tsx";
import { IconButton } from "../../../../design/components/button/IconButton.tsx";
import { KeyboardCaptureModal } from "../../../../design/components/modal/KeyboardCaptureModal.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import { CATALOGS } from "../../../../i18n/messages/index.ts";
import { tRaw as translateRaw } from "../../../../i18n/index.ts";
import { registerSettingsPage, type SettingsPageContext } from "../settingsContributions.ts";
import { canonicalText, displayText } from "../../../../core/shortcuts/keys.ts";
import { shortcutMatchesSearch, shortcutPageSearchTerms } from "./shortcutSearch.ts";
import { shortcutRegistry as shortcuts } from "../../../../core/shortcuts/registry.ts";
import { developerMode } from "../../../../core/platform/desktop/developer.ts";
import { developerReveal, isDeveloperRevealed } from "../../../../core/state/developerReveal.ts";
import { useShortcuts } from "./useShortcuts.ts";
import { advanceShortcutCapture, createShortcutCaptureState } from "./shortcutCapture.ts";
import { setShortcutRecording } from "./recordingState.ts";
import {
  clearRpeHotkeyRecord,
  readRpeHotkeyRecord,
  type RpeHotkeyRecord,
} from "./rpeHotkeyReport.ts";
import type {
  Shortcut,
  ShortcutEventLike,
  ShortcutView,
} from "../../../../core/shortcuts/types.ts";

/** The modifiers held while the last key of a chord is still missing. */
function heldModifiers(event: ShortcutEventLike): string {
  return [
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Meta" : "",
  ]
    .filter(Boolean)
    .join(" + ");
}

/** Resolve the localized names of commands that share one shortcut. */
function conflictLabels(
  view: ShortcutView,
  views: readonly ShortcutView[],
  tRaw: (key: string) => string,
  binding?: Shortcut,
): string[] {
  const conflicts = binding
    ? views.filter(
        (candidate) =>
          candidate.id !== view.id &&
          !view.shared &&
          !candidate.shared &&
          shortcuts.definition(candidate.id)?.enabled?.() !== false &&
          candidate.bindings.some(
            (candidateBinding) => canonicalText(candidateBinding) === canonicalText(binding),
          ),
      )
    : view.conflicts
        .map((id) => views.find((candidate) => candidate.id === id))
        .filter((candidate): candidate is ShortcutView => candidate !== undefined);
  return conflicts.map((conflict) => tRaw(conflict.title));
}

/** The developer section is open when the host enables it or the About page revealed it. */
const developerAvailableNow = (): boolean => developerMode.get() || isDeveloperRevealed();

/** English catalog text for a host shortcut key; extension literals have none. */
function englishShortcutTitle(key: string): string | undefined {
  return (CATALOGS.en as Record<string, string | undefined>)[key];
}

/** Apply the developer visibility rule to a shortcut list. */
function visibleShortcutViews(
  views: readonly ShortcutView[],
  developerAvailable: boolean,
): readonly ShortcutView[] {
  return developerAvailable ? views : views.filter((view) => view.category !== "developer");
}

/** Combine every developer-availability signal into one subscription. */
const subscribeDeveloperAvailability = (listener: () => void): (() => void) => {
  const disposeMode = developerMode.subscribe(listener);
  const disposeReveal = developerReveal.subscribe(listener);
  return () => {
    disposeMode();
    disposeReveal();
  };
};

/**
 * One migration's hotkey mapping, shown above the editor.
 *
 * Applied rows point at the command they changed, so the user can see the new
 * binding in place. Rows without a command are the ones that explain why a
 * familiar key does nothing here; they are listed with their original key.
 */
const MAX_MAPPED_ROWS = 200;
const MAX_UNMAPPED_ROWS = 200;

function RpeHotkeySection({
  record,
  onClear,
  findRow,
}: {
  record: RpeHotkeyRecord;
  onClear(): void;
  findRow(id: string): HTMLElement | null;
}) {
  const { t } = useTranslation();
  const mapped = record.entries.filter((entry) => entry.target);
  const unmapped = record.entries.filter((entry) => !entry.target);
  // A tampered or enormous Hotkey.txt must not build thousands of buttons.
  const mappedShown = mapped.slice(0, MAX_MAPPED_ROWS);
  const unmappedShown = unmapped.slice(0, MAX_UNMAPPED_ROWS);
  /** Scrolls to one edited command and marks it so the row is findable. */
  const reveal = (id: string) => {
    const row = findRow(id);
    if (!row) {
      return;
    }
    row.scrollIntoView({ block: "center" });
    row.dataset.flash = "true";
    window.setTimeout(() => delete row.dataset.flash, 1200);
  };
  return (
    <section className="redux-shortcut-category redux-shortcut-rpe">
      <h3>{t("shortcuts.rpeSection.title")}</h3>
      <p className="redux-shortcut-rpe-summary">
        {t("shortcuts.rpeSection.summary", { mapped: mapped.length, unmapped: unmapped.length })}
      </p>
      {mapped.length > 0 && (
        <div className="redux-shortcut-rpe-group">
          <h4>{t("shortcuts.rpeSection.mapped")}</h4>
          <div className="redux-shortcut-rpe-chips">
            {mappedShown.map((entry, index) => (
              <Button
                key={`${index}:${entry.action}`}
                variant="outlined"
                className="redux-shortcut-rpe-chip"
                data-tip-title={t("shortcuts.rpeSection.revealHint")}
                onClick={() => entry.target && reveal(entry.target)}
              >
                <span className="redux-shortcut-rpe-keys">{entry.binding}</span>
                <span className="redux-shortcut-rpe-action">{entry.action}</span>
              </Button>
            ))}
          </div>
          {mapped.length > mappedShown.length && (
            <p className="redux-shortcut-rpe-summary">
              {t("shortcuts.rpeSection.more", { count: mapped.length - mappedShown.length })}
            </p>
          )}
        </div>
      )}
      {unmapped.length > 0 && (
        <div className="redux-shortcut-rpe-group">
          <h4>{t("shortcuts.rpeSection.unmapped")}</h4>
          <ul className="redux-shortcut-rpe-list">
            {unmappedShown.map((entry, index) => (
              <li key={`${index}:${entry.action}`} className="redux-shortcut-rpe-row">
                <span className="redux-shortcut-rpe-keys">{entry.binding}</span>
                <span className="redux-shortcut-rpe-action">{entry.action}</span>
                <span className="redux-shortcut-rpe-reason">
                  {t(
                    entry.reason === "invalid-binding"
                      ? "shortcuts.rpeSection.invalidBinding"
                      : "shortcuts.rpeSection.unknownAction",
                  )}
                </span>
              </li>
            ))}
          </ul>
          {unmapped.length > unmappedShown.length && (
            <p className="redux-shortcut-rpe-summary">
              {t("shortcuts.rpeSection.more", { count: unmapped.length - unmappedShown.length })}
            </p>
          )}
        </div>
      )}
      <div className="redux-footer-bar">
        <div className="redux-footer-actions">
          <Button
            variant="plain"
            onClick={() => {
              clearRpeHotkeyRecord();
              onClear();
            }}
          >
            {t("shortcuts.rpeSection.clear")}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** The shortcut editor for every binding the registry exposes. */
export function ShortcutsSettings({ query }: SettingsPageContext) {
  const { t, tRaw } = useTranslation();
  const allViews = useShortcuts();
  const developerAvailable = useSyncExternalStore(
    subscribeDeveloperAvailability,
    developerAvailableNow,
    developerAvailableNow,
  );
  const views = visibleShortcutViews(allViews, developerAvailable);
  const [message, setMessage] = useState("");
  // The recording target and its display data outlive the open session by one
  // exit transition: the dialog keeps painting while `recordingOpen` is false.
  const [recording, setRecording] = useState<string | null>(null);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [recordingBindings, setRecordingBindings] = useState<readonly string[]>([]);
  const [rpeRecord, setRpeRecord] = useState<RpeHotkeyRecord | null>(readRpeHotkeyRecord);
  const [bindingIndex, setBindingIndex] = useState<number | null>(null);
  const [modifierPreview, setModifierPreview] = useState("");
  const [pendingShortcut, setPendingShortcut] = useState<Shortcut | null>(null);
  const captureState = useRef(createShortcutCaptureState());
  const pendingShortcutRef = useRef<Shortcut | null>(null);
  /** Guards handlers that may still run between closing the dialog and their cleanup. */
  const recordingOpenRef = useRef(false);
  const shortcutRows = useRef(new Map<string, HTMLElement>());

  // Clear global recording ownership when the editor unmounts.
  useEffect(() => () => setShortcutRecording(false), []);

  /**
   * End the capture session without touching what the dialog displays.
   *
   * The modal keeps painting through its exit transition after `open` turns
   * false, so the title, bindings, preview, error, and actions keep their last
   * values until `startRecording` replaces them. Only keyboard ownership and
   * the capture machine are dropped here.
   */
  const stopRecording = useCallback(() => {
    captureState.current = createShortcutCaptureState();
    recordingOpenRef.current = false;
    setShortcutRecording(false);
    setRecordingOpen(false);
    pendingShortcutRef.current = null;
  }, []);

  /** Begin capturing the next input for one shortcut slot. */
  const startRecording = (shortcutId: string, index: number | null) => {
    captureState.current = createShortcutCaptureState();
    recordingOpenRef.current = true;
    setShortcutRecording(true);
    setMessage("");
    setModifierPreview("");
    setPendingShortcut(null);
    pendingShortcutRef.current = null;
    setRecordingBindings(shortcuts.bindingsOf(shortcutId).map(displayText));
    setBindingIndex(index);
    setRecording(shortcutId);
    setRecordingOpen(true);
  };

  /** Write the captured shortcut into its slot, or report why the registry refused. */
  const saveShortcut = useCallback(() => {
    if (!recordingOpen || recording === null) {
      return;
    }
    const shortcut = pendingShortcut;
    if (shortcut === null) {
      stopRecording();
      return;
    }
    const current = shortcuts.bindingsOf(recording);
    const original = bindingIndex === null ? undefined : current[bindingIndex];
    if (original && canonicalText(original) === canonicalText(shortcut)) {
      stopRecording();
      return;
    }
    const result =
      bindingIndex === null
        ? shortcuts.addBinding(recording, shortcut)
        : shortcuts.replaceBinding(recording, bindingIndex, shortcut);
    if (result.ok) {
      const updatedView = shortcuts.shortcuts().find((view) => view.id === recording);
      const conflicts =
        updatedView && pendingShortcut
          ? conflictLabels(updatedView, allViews, tRaw, pendingShortcut)
          : [];
      if (conflicts.length > 0) {
        setMessage(
          t("shortcuts.conflictNotice", {
            actions: conflicts.join(t("shortcuts.conflictSeparator")),
          }),
        );
      }
      stopRecording();
      return;
    }
    setMessage(tRaw(result.error ?? "shortcuts.error.invalidShortcut"));
  }, [allViews, bindingIndex, pendingShortcut, recording, recordingOpen, stopRecording, t, tRaw]);

  // Capture keyboard, pointer, and wheel input while a row is recording.
  useEffect(() => {
    if (!recordingOpen) {
      return;
    }
    const fromActions = (target: EventTarget | null): boolean =>
      target instanceof Element && Boolean(target.closest("[data-shortcut-actions]"));
    // Keep the ref in step with the state so the long-lived listeners can tell
    // whether a shortcut has already been captured.
    const commit = (shortcut: Shortcut) => {
      pendingShortcutRef.current = shortcut;
      setPendingShortcut(shortcut);
      setModifierPreview(displayText(shortcut));
      captureState.current = createShortcutCaptureState();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!recordingOpenRef.current) {
        return;
      }
      if (fromActions(event.target) && event.key !== "Escape") {
        return;
      }
      // Recording owns the keyboard while it lasts: the modal must not treat
      // Escape as cancel, so Escape can become a binding. The Cancel button ends
      // recording without saving.
      event.stopPropagation();
      event.preventDefault();
      const transition = advanceShortcutCapture(captureState.current, {
        type: "keydown",
        event,
      });
      captureState.current = transition.state;
      if (transition.cancelled) {
        stopRecording();
        return;
      }
      if (transition.state.candidate) {
        setModifierPreview(displayText(transition.state.candidate));
      } else {
        setModifierPreview(heldModifiers(event));
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!recordingOpenRef.current) {
        return;
      }
      if (fromActions(event.target) && event.key !== "Escape") {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      const transition = advanceShortcutCapture(captureState.current, {
        type: "keyup",
        event,
      });
      captureState.current = transition.state;
      if (transition.commit) {
        commit(transition.commit);
      } else if (transition.state.candidate) {
        setModifierPreview(displayText(transition.state.candidate));
      } else if (pendingShortcutRef.current === null) {
        // Releasing the modifiers after a pointer or wheel capture must not
        // blank the shortcut that is already waiting for Save.
        setModifierPreview(heldModifiers(event));
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!recordingOpenRef.current) {
        return;
      }
      if (fromActions(event.target)) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      const transition = advanceShortcutCapture(captureState.current, {
        type: "pointerdown",
        event,
      });
      captureState.current = transition.state;
      if (transition.state.candidate) {
        setModifierPreview(displayText(transition.state.candidate));
      } else {
        setModifierPreview(heldModifiers(event));
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!recordingOpenRef.current) {
        return;
      }
      // A press on the action row never enters the capture; only release a
      // mouse key that the capture actually owns.
      if (!captureState.current.pressedKeys.some((key) => key.startsWith("MOUSE"))) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      const transition = advanceShortcutCapture(captureState.current, {
        type: "pointerup",
        event,
      });
      captureState.current = transition.state;
      if (transition.commit) {
        commit(transition.commit);
      } else if (transition.state.candidate) {
        setModifierPreview(displayText(transition.state.candidate));
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (!recordingOpenRef.current) {
        return;
      }
      if (fromActions(event.target)) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      const transition = advanceShortcutCapture(captureState.current, {
        type: "wheel",
        event,
      });
      captureState.current = transition.state;
      if (transition.commit) {
        commit(transition.commit);
      }
    };
    /**
     * End capture only when the window itself loses focus.
     *
     * A capture-phase `blur` listener also receives the blur of an element
     * inside the dialog, so pressing Save or Cancel would stop recording before
     * the click's handler ran and the captured key would be dropped. Element
     * blurs target the element; only the window's own blur has `window` as its
     * target.
     */
    const onWindowBlur = (event: FocusEvent) => {
      if (event.target === window) {
        stopRecording();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopRecording();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window.addEventListener("blur", onWindowBlur, true);
    document.addEventListener("visibilitychange", onVisibilityChange, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("blur", onWindowBlur, true);
      document.removeEventListener("visibilitychange", onVisibilityChange, true);
    };
  }, [recordingOpen, stopRecording]);

  /** Delete the binding in the recorded slot. */
  const removeBinding = useCallback(() => {
    if (!recordingOpen || recording === null || bindingIndex === null) {
      return;
    }
    shortcuts.removeBinding(recording, bindingIndex);
    stopRecording();
  }, [bindingIndex, recording, recordingOpen, stopRecording]);

  const filtering = query.trim().length > 0;
  const searchTitles = { text: tRaw, english: englishShortcutTitle };
  const categories = shortcuts.categories();
  const shownViews = filtering
    ? views.filter((view) => {
        const category = categories.find((entry) => entry.id === view.category);
        return category !== undefined && shortcutMatchesSearch(view, category, query, searchTitles);
      })
    : views;
  const groups = categories
    .map((category) => ({
      category,
      entries: shownViews.filter((view) => view.category === category.id),
    }))
    .filter((group) => group.entries.length > 0);
  const recordingView = recording ? views.find((view) => view.id === recording) : null;
  const recordingLabel = recordingView ? tRaw(recordingView.title) : (recording ?? "");
  const recordingTitle =
    recording === null
      ? ""
      : bindingIndex === null
        ? t("shortcuts.recordingOverlayAdd", { action: recordingLabel })
        : t("shortcuts.recordingOverlayRebind", { action: recordingLabel });

  /** The text a binding chip shows; recording feedback lives in the modal. */
  const bindingLabel = (binding: Shortcut): string => displayText(binding);

  return (
    <div className="redux-setting-group redux-shortcuts">
      {message && (
        <p className="redux-shortcut-message" role="status">
          {message}
        </p>
      )}
      {!filtering && rpeRecord && rpeRecord.entries.length > 0 && (
        <RpeHotkeySection
          record={rpeRecord}
          onClear={() => setRpeRecord(null)}
          findRow={(id) => shortcutRows.current.get(id) ?? null}
        />
      )}
      {groups.map(({ category, entries }) => (
        <section key={category.id} className="redux-shortcut-category">
          <h3>{tRaw(category.title)}</h3>
          {entries.map((view) => {
            return (
              <div
                className="redux-shortcut-row"
                key={view.id}
                data-command={view.id}
                ref={(node) => {
                  if (node) {
                    shortcutRows.current.set(view.id, node);
                  } else {
                    shortcutRows.current.delete(view.id);
                  }
                }}
              >
                <span className="redux-shortcut-label">{tRaw(view.title)}</span>
                <div className="redux-shortcut-actions">
                  <IconButton
                    icon="plus"
                    size={16}
                    className="redux-shortcut-add"
                    label={t("shortcuts.addBinding")}
                    onClick={() => startRecording(view.id, null)}
                  />
                  {view.overridden && (
                    <IconButton
                      icon="undo"
                      size={16}
                      className="redux-shortcut-reset"
                      label={t("shortcuts.resetCommand")}
                      title={t("shortcuts.resetCommandShort")}
                      onClick={() => {
                        shortcuts.resetShortcut(view.id);
                        stopRecording();
                      }}
                    />
                  )}
                  {view.bindings.map((binding, index) => {
                    const conflicts = conflictLabels(view, allViews, tRaw, binding);
                    const conflictDescription =
                      conflicts.length > 0
                        ? t("shortcuts.conflictDescription", {
                            actions: conflicts.join(t("shortcuts.conflictSeparator")),
                          })
                        : undefined;
                    return (
                      <span
                        className="redux-shortcut-chip"
                        key={canonicalText(binding)}
                        data-binding={canonicalText(binding)}
                        data-conflict={String(conflicts.length > 0)}
                        data-tip-title={
                          conflictDescription ? t("shortcuts.conflictTitle") : undefined
                        }
                        data-tip-desc={conflictDescription}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          className="redux-shortcut-capture"
                          onClick={() => startRecording(view.id, index)}
                        >
                          {bindingLabel(binding)}
                        </Button>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      ))}
      <KeyboardCaptureModal
        open={recordingOpen}
        title={recordingTitle}
        onCancel={stopRecording}
        actionsProps={{ "data-shortcut-actions": "" }}
        actions={
          <>
            {bindingIndex !== null && (
              <Button variant="danger" onClick={removeBinding}>
                {t("shortcuts.delete")}
              </Button>
            )}
            <Button variant="outlined" onClick={stopRecording}>
              {t("shortcuts.cancel")}
            </Button>
            <Button
              variant="solid"
              disabled={pendingShortcut === null && bindingIndex === null}
              onClick={saveShortcut}
            >
              {t("shortcuts.save")}
            </Button>
          </>
        }
      >
        <div className="redux-shortcut-recording-current">
          <span>{t("shortcuts.currentBindingsLabel")}</span>
          <div className="redux-shortcut-recording-bindings">
            {recordingBindings.length > 0 ? (
              recordingBindings.map((binding) => <kbd key={binding}>{binding}</kbd>)
            ) : (
              <kbd>—</kbd>
            )}
          </div>
        </div>
        {modifierPreview && <p className="redux-shortcut-recording-modifiers">{modifierPreview}</p>}
        {message && <p className="redux-shortcut-recording-message">{message}</p>}
      </KeyboardCaptureModal>
    </div>
  );
}

registerSettingsPage("shortcuts", {
  keywords: "settings.search.shortcutsKeywords",
  searchText: () =>
    shortcutPageSearchTerms(
      shortcuts.categories(),
      visibleShortcutViews(shortcuts.shortcuts(), developerAvailableNow()),
      { text: translateRaw, english: englishShortcutTitle },
    ),
  component: ShortcutsSettings,
});
