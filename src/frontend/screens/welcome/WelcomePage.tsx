/**
 * The home screen.
 *
 * It composes the page header, the permanent selected-chart column, and the
 * chart library. The detail column stays mounted through loading, empty, and
 * failed reads, so the two-column grid never collapses or snaps in after the
 * first read; it prompts until the user selects a chart. Selection is owned
 * here because the detail pane and the list are siblings, while opening,
 * exporting, and deleting stay with the published card actions. Files dropped
 * on the window are imported by the desktop lifecycle, which broadcasts its
 * drag state here for the drop overlay.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "../../../i18n/react.ts";
import { Icon } from "../../../design/components/icon/Icon.tsx";
import { FILE_DRAG_EVENT } from "../../../core/shell/shellEventNames.ts";
import { WelcomeSettings } from "./WelcomeSettings.tsx";
import { WelcomeJoin } from "./WelcomeJoin.tsx";
import { WelcomeMoreMenu } from "./WelcomeMoreMenu.tsx";
import { WelcomeImportDialog } from "./WelcomeImportDialog.tsx";
import { RpeImportReviewDialog } from "./RpeImportReviewDialog.tsx";
import { LibraryPanel } from "./library/LibraryPanel.tsx";
import { LibraryDetail } from "./library/LibraryDetail.tsx";
import { buildLibraryEntries, type LibraryEntry } from "./library/libraryEntries.ts";
import { libraryDetailState, resolveLibrarySelection } from "./library/libraryDetailState.ts";
import { getHomeProjectCardsSnapshot, subscribeHomeProjectCards } from "./homeProjectCards.ts";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../core/edit/state/visibility.ts";

/** Home screen composing the selected-chart card and the chart library. */
export function WelcomePage({ onCoverUrlChange }: { onCoverUrlChange: (url: string) => void }) {
  const { t } = useTranslation();
  const editorVisibility = useSyncExternalStore(
    subscribeToEditorVisibility,
    getEditorVisibility,
    getEditorVisibility,
  );
  const cards = useSyncExternalStore(
    subscribeHomeProjectCards,
    getHomeProjectCardsSnapshot,
    getHomeProjectCardsSnapshot,
  );
  const entries = useMemo(() => buildLibraryEntries(cards), [cards]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [handledRemoveFailure, setHandledRemoveFailure] = useState(0);
  const removeFailure = cards?.removeFailure ?? null;
  if (removeFailure && removeFailure.nonce !== handledRemoveFailure) {
    // A refused delete leaves the chart in place. Put the selection back on it
    // so the failure has a visible target and the user can retry in place.
    setHandledRemoveFailure(removeFailure.nonce);
    setSelectedKey(`project:${removeFailure.projectId}`);
    setArmedKey(null);
  }
  // Selection stays explicit: a populated library starts on a prompt rather
  // than an implied first chart. Preview audio also waits for an explicit click
  // so entering the home screen never starts sound on its own.
  const selected = useMemo(
    () => resolveLibrarySelection(entries, selectedKey),
    [entries, selectedKey],
  );
  const detailState = libraryDetailState(entries, selected);
  const previewArmed = selected !== null && armedKey === selected.key;
  useEffect(() => {
    onCoverUrlChange(selected?.cover ?? "");
  }, [onCoverUrlChange, selected?.cover]);
  useEffect(() => {
    const onDragState = (event: Event): void => {
      const state = (event as CustomEvent<string>).detail;
      setDraggingFiles(state === "enter" || state === "over");
    };
    window.addEventListener(FILE_DRAG_EVENT, onDragState);
    return () => window.removeEventListener(FILE_DRAG_EVENT, onDragState);
  }, []);
  /** Opens the selected entry through the published card actions. */
  const openEntry = (entry: LibraryEntry) => {
    cards?.onOpenProject(entry.source.project.id);
  };
  /** Exports the selected entry to a user-chosen chart file. */
  const exportEntry = (entry: LibraryEntry) => {
    cards?.onExportProject(entry.source.project.id);
  };
  /** Asks for confirmation before removing the selected entry. */
  const deleteEntry = (entry: LibraryEntry) => {
    cards?.onDelete(entry.source.project);
  };
  return (
    <main id="home" className="redux-home-page" hidden={!editorVisibility.atHome}>
      <div className="redux-welcome">
        <header className="redux-welcome-header">
          <div className="redux-welcome-actions">
            <WelcomeSettings />
            <WelcomeMoreMenu />
          </div>
        </header>
        <div className="redux-welcome-join">
          <WelcomeJoin />
        </div>
        <div className="redux-welcome-columns" data-detail={detailState} data-layout="fixed">
          <div className="redux-welcome-side">
            <LibraryDetail
              entry={selected}
              visible={editorVisibility.atHome}
              preview={previewArmed}
              onOpen={openEntry}
              onExport={exportEntry}
              onDelete={deleteEntry}
            />
          </div>
          <LibraryPanel
            selectedKey={selected?.key ?? null}
            onSelect={(key, preview) => {
              setSelectedKey(key);
              setArmedKey(preview ? key : null);
            }}
          />
        </div>
      </div>
      {draggingFiles && editorVisibility.atHome && (
        <div className="redux-welcome-drop" role="status" aria-live="polite">
          <div className="redux-welcome-drop-card">
            <span className="redux-welcome-drop-icon" aria-hidden="true">
              <Icon name="open" size={24} />
            </span>
            <strong>{t("workspace.welcome.drop.title")}</strong>
          </div>
        </div>
      )}
      <WelcomeImportDialog />
      <RpeImportReviewDialog />
    </main>
  );
}
