/**
 * Draws the two-step restore question: the backup list, then the overwrite
 * confirmation.
 *
 * The question itself lives in `restorePrompt`; this file only renders the step
 * that module publishes and sends the footer's answer back to it. The host is
 * resolved from the editor's own seams, so the dialog mounts once for the whole
 * window instead of once per document.
 */
import { useSyncExternalStore } from "react";
import { Button } from "../../../../../../design/components/button/Button.tsx";
import { InlineAlert } from "../../../../../../design/components/alert/InlineAlert.tsx";
import { useTranslation } from "../../../../../../i18n/react.ts";
import { formatChartingTime } from "../../../../welcome/library/libraryFormat.ts";
import { editorChromeCommands } from "../../../../../contracts/editorCommands.ts";
import { ModalRequest } from "../../../../../overlays/modals/ModalRequest.ts";
import {
  closeRestorePrompt,
  formatSnapshotTime,
  getRestoreState,
  resolveRestore,
  selectRestoreSnapshot,
  subscribeRestoreState,
  type RestoreHost,
  type RestoreState,
} from "./restorePrompt.ts";

/** The editor seams a restore needs, read from the chrome contract. */
function chromeRestoreHost(): RestoreHost {
  const commands = editorChromeCommands();
  return {
    saveCurrentAsBackup: () => commands?.documents.backupOpenDocument() ?? Promise.resolve(),
    reloadProject: (projectId) => commands?.documents.reloadProject(projectId) ?? Promise.resolve(),
  };
}

/** The restore dialog, or nothing while no question is open. */
export function RestoreBackupDialog() {
  const restore = useSyncExternalStore(subscribeRestoreState, getRestoreState, getRestoreState);
  if (!restore) {
    return null;
  }
  return <RestoreBody key={restore.id} restore={restore} host={chromeRestoreHost()} />;
}

/** One step of the question: the list, or the confirmation for a picked backup. */
function RestoreBody({ restore, host }: { restore: RestoreState; host: RestoreHost }) {
  const { t } = useTranslation();
  const selected = restore.selected;
  return (
    <ModalRequest
      requestId={`restore-backup:${restore.id}`}
      open
      onClose={closeRestorePrompt}
      label={restore.title}
      className="redux-restore-backup-dialog"
      {...(selected
        ? {
            description: t("editor.dialogs.restoreBackup.confirmDescription", {
              time: formatSnapshotTime(selected.createdAt),
            }),
            role: "alertdialog" as const,
          }
        : {})}
      actions={
        selected ? (
          <RestoreConfirmActions host={host} pending={restore.pending} />
        ) : (
          <Button variant="outlined" onClick={closeRestorePrompt}>
            {t("common.action.cancel")}
          </Button>
        )
      }
    >
      {selected ? <BackupSummary restore={restore} /> : <BackupList restore={restore} />}
    </ModalRequest>
  );
}

/** The list of saved backups, newest first. */
function BackupList({ restore }: { restore: RestoreState }) {
  const { t } = useTranslation();
  if (!restore.loaded) {
    return (
      <p className="redux-restore-backup-empty">{t("editor.dialogs.restoreBackup.loading")}</p>
    );
  }
  if (!restore.snapshots.length) {
    return (
      <>
        <p className="redux-restore-backup-empty">{t("editor.dialogs.restoreBackup.none")}</p>
        {restore.error ? <InlineAlert>{restore.error}</InlineAlert> : null}
      </>
    );
  }
  return (
    <>
      <ul className="redux-restore-backup-list">
        {restore.snapshots.map((snapshot) => (
          <li key={snapshot.id}>
            <Button
              type="button"
              variant="plain"
              className="redux-restore-backup-row"
              onClick={() => selectRestoreSnapshot(snapshot)}
            >
              <span className="redux-restore-backup-time">
                {formatSnapshotTime(snapshot.createdAt)}
              </span>
              <span className="redux-restore-backup-counts">
                {t("editor.dialogs.restoreBackup.counts", {
                  notes: snapshot.noteCount,
                  events: snapshot.eventCount,
                })}
                {snapshot.editSeconds > 0
                  ? ` · ${t("editor.dialogs.restoreBackup.workedFor", {
                      time: formatChartingTime(snapshot.editSeconds),
                    })}`
                  : ""}
              </span>
            </Button>
          </li>
        ))}
      </ul>
      {restore.error ? <InlineAlert>{restore.error}</InlineAlert> : null}
    </>
  );
}

/** The picked backup's own numbers plus the warning this step carries. */
function BackupSummary({ restore }: { restore: RestoreState }) {
  const { t } = useTranslation();
  const selected = restore.selected;
  if (!selected) {
    return null;
  }
  return (
    <>
      <dl className="redux-restore-backup-summary">
        <div>
          <dt>{t("editor.dialogs.restoreBackup.savedAt")}</dt>
          <dd>{formatSnapshotTime(selected.createdAt)}</dd>
        </div>
        <div>
          <dt>{t("editor.dialogs.restoreBackup.notes")}</dt>
          <dd>{selected.noteCount}</dd>
        </div>
        <div>
          <dt>{t("editor.dialogs.restoreBackup.events")}</dt>
          <dd>{selected.eventCount}</dd>
        </div>
        {selected.editSeconds > 0 ? (
          <div>
            <dt>{t("editor.dialogs.restoreBackup.workedForLabel")}</dt>
            <dd>{formatChartingTime(selected.editSeconds)}</dd>
          </div>
        ) : null}
      </dl>
      {restore.error ? <InlineAlert>{restore.error}</InlineAlert> : null}
    </>
  );
}

/** Cancel, keep the current work, or save it before the backup is applied. */
function RestoreConfirmActions({ host, pending }: { host: RestoreHost; pending: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <Button variant="outlined" disabled={pending} onClick={closeRestorePrompt}>
        {t("common.action.cancel")}
      </Button>
      <Button
        variant="danger"
        disabled={pending}
        onClick={() => void resolveRestore(host, "discard")}
      >
        {t("editor.dialogs.restoreBackup.discard")}
      </Button>
      <Button variant="solid" disabled={pending} onClick={() => void resolveRestore(host, "save")}>
        {t("common.action.save")}
      </Button>
    </>
  );
}
