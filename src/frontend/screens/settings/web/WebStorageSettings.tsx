/**
 * Browser storage settings page.
 *
 * The static web build keeps its chart library in OPFS. This page reports the
 * browser quota, requests persistent storage, and downloads a portable SQLite
 * backup. It is registered only for the web host.
 */
import { useEffect, useState } from "react";
import { Button } from "../../../../design/components/button/Button.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import { localService } from "../../../../core/global/library/service.ts";
import { requestConfirm } from "../../../overlays/modals/prompts.ts";
import { pickFiles } from "../../../platform/filePicker.ts";
import { download } from "../../../platform/download.ts";
import type { BrowserLibrary } from "../../../../core/platform/browser/library/browserLibrary.ts";
import { registerSettingsPage } from "../settingsContributions.ts";

interface StorageStatus {
  readonly persisted: boolean;
  readonly usage: number;
  readonly quota: number;
}

/** Format a byte count for the storage readout. */
function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  let size = value;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/** Storage status, persistence request, and backup download for the web build. */
export function WebStorageSettings() {
  const { t } = useTranslation();
  const [library, setLibrary] = useState<BrowserLibrary | null>(null);
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const found = await localService();
        const { BrowserLibrary } =
          await import("../../../../core/platform/browser/library/browserLibrary.ts");
        if (!found || !(found.library instanceof BrowserLibrary)) {
          if (active) {
            setError(t("settings.webStorage.unsupported"));
          }
          return;
        }
        const next = await found.library.storageStatus();
        if (active) {
          setLibrary(found.library);
          setStatus(next);
        }
      } catch (failure) {
        if (active) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [t]);

  /** Refresh the quota and persistence readout. */
  const refresh = async (target: BrowserLibrary | null = library) => {
    if (!target) {
      return;
    }
    setStatus(await target.storageStatus());
  };

  /** Ask for persistent storage, then show the browser's answer. */
  const requestPersistence = async () => {
    if (!library) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const granted = await library.requestPersistence();
      setMessage(
        t(granted ? "settings.webStorage.requestGranted" : "settings.webStorage.requestDenied"),
      );
      await refresh(library);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  /** Replace the browser library with a downloaded SQLite backup. */
  const restoreBackup = async () => {
    if (!library) {
      return;
    }
    const files = await pickFiles({ accept: ".sqlite,.db,application/vnd.sqlite3" });
    const file = files?.[0];
    if (!file) {
      return;
    }
    const accepted = await requestConfirm({
      title: t("settings.webStorage.restoreConfirmTitle"),
      description: t("settings.webStorage.restoreConfirmDescription"),
      label: t("settings.webStorage.restore"),
      cancelLabel: t("common.action.cancel"),
      destructive: true,
    });
    if (!accepted) {
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await library.importDatabase(new Uint8Array(await file.arrayBuffer()));
      setMessage(t("settings.webStorage.restoreDone"));
      window.location.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  /** Write the current library as a portable SQLite file. */
  const downloadBackup = async () => {
    if (!library) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const bytes = await library.exportDatabase();
      download(
        new Blob([bytes.slice().buffer], { type: "application/vnd.sqlite3" }),
        "rpe-redux-backup.sqlite",
      );
      setMessage(t("settings.webStorage.downloaded"));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="redux-web-storage">
      <p className="redux-web-storage-copy">{t("settings.webStorage.description")}</p>
      {error && (
        <p className="redux-web-storage-error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <section className="redux-web-storage-card" aria-label={t("settings.group.webStorage")}>
          <dl className="redux-web-storage-grid">
            <dt className="redux-web-storage-label">{t("settings.webStorage.mode")}</dt>
            <dd>
              {t(
                status.persisted
                  ? "settings.webStorage.persistent"
                  : "settings.webStorage.bestEffort",
              )}
            </dd>
            <dt className="redux-web-storage-label">{t("settings.webStorage.usage")}</dt>
            <dd>
              {formatBytes(status.usage)} / {formatBytes(status.quota)}
            </dd>
          </dl>
          <div className="redux-web-storage-actions">
            <Button
              variant="outlined"
              disabled={busy || status.persisted}
              onClick={() => void requestPersistence()}
            >
              {t("settings.webStorage.request")}
            </Button>
            <Button variant="solid" disabled={busy} onClick={() => void downloadBackup()}>
              {t("settings.webStorage.download")}
            </Button>
            <Button variant="outlined" disabled={busy} onClick={() => void restoreBackup()}>
              {t("settings.webStorage.restore")}
            </Button>
            <Button variant="plain" disabled={busy} onClick={() => void refresh()}>
              {t("settings.webStorage.refresh")}
            </Button>
          </div>
        </section>
      )}
      <p className="redux-web-storage-note">{t("settings.webStorage.backupNote")}</p>
      {message && (
        <p className="redux-web-storage-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

registerSettingsPage("web.storage", {
  keywords: "settings.search.webStorageKeywords",
  component: WebStorageSettings,
});
