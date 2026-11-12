/**
 * The editor's shared notice and error policy: toasts, diagnostics, storage
 * recovery, and load-failure de-duplication. Feature modules call this seam; the
 * toast host and dialogs own presentation.
 */
import { t } from "../../../../../../i18n/index.ts";
import {
  setToastPolicy,
  showToast,
  type ToastContent,
} from "../../../../../../design/patterns/ToastHost.tsx";
import { requestChoice, showNotice } from "../../../../../overlays/modals/prompts.ts";
import { loadingProgress } from "../../../../../../core/global/document/loading.ts";
import { exportAppDataBackup } from "../../../../../../core/platform/desktop/appDataBackup.ts";
import { isStorageFailure } from "../../../../../../core/platform/storageFailure.ts";
import { diagnosticText, writeDiagnosticLog } from "../../../../../platform/diagnosticLog.ts";
import { recordDiagnosticIssue } from "../../../../../../core/diagnostics/interactionLog.ts";

/** The notice/error surface, as the assembly factories consume it. */
export type EditorFeedback = ReturnType<typeof createEditorFeedback>;

/** Shared transient notice and error-dialog policy for the editor. */
export function createEditorFeedback() {
  // Completion notices are part of the editor feedback policy and are always on.
  setToastPolicy({ allowed: () => true });
  /** Shows a transient notice at the requested severity, or the full content form. */
  const notify = (content: string | ToastContent, level = "success", duration?: number): number =>
    typeof content === "string" ? showToast(content, level, duration) : showToast(content);
  /** Extracts the human-readable message from a thrown value. */
  const failureMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);
  /**
   * True when the loading card already shows this exact failure, so the same
   * message is not painted again as a toast and a notice.
   */
  const alreadyOnLoadingCard = (message: string): boolean => {
    const state = loadingProgress.getSnapshot();
    return state?.status === "error" && state.error === message;
  };
  /** Logs a diagnostic and presents the failure, with storage recovery when relevant. */
  const reportError = (error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") {
      return;
    }
    const message = failureMessage(error);
    recordDiagnosticIssue("error", "frontend", error, "editor.feedback");
    if (alreadyOnLoadingCard(message)) {
      return;
    }
    const stack = diagnosticText(error);
    void writeDiagnosticLog(
      [
        t("settings.startup.reportTitle"),
        t("settings.startup.reportTime", { time: new Date().toISOString() }),
        t("settings.startup.reportRuntime", { runtime: navigator.userAgent }),
        "",
        stack,
      ].join("\n"),
    );
    const reportDetail = `${stack}\n\n${t("settings.startup.logGuide")}`;
    if (isStorageFailure(error)) {
      notify(t("system.library.storageError"), "error", 6500);
      const exportLabel = t("system.backup.exportAction");
      const continueLabel = t("system.backup.dismissAction");
      void requestChoice({
        title: t("system.backup.title"),
        description: t("system.backup.description"),
        detail: reportDetail,
        entries: [exportLabel, continueLabel],
        label: (value) => value,
      }).then(async (choice) => {
        if (choice !== exportLabel) {
          return;
        }
        try {
          const path = await exportAppDataBackup();
          if (path) {
            showNotice({
              title: t("system.backup.title"),
              description: t("system.backup.success", { path }),
            });
          }
        } catch (backupError) {
          showNotice({
            title: t("system.backup.title"),
            description: t("system.backup.failed", {
              message: failureMessage(backupError),
            }),
          });
        }
      });
      return;
    }
    notify(message, "error", 5000);
    showNotice({
      title: t("editor.dialogs.dialog.incomplete"),
      description: message,
      detail: reportDetail,
    });
  };
  return { notify, failureMessage, reportError };
}
