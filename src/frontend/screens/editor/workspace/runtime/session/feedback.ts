/**
 * The editor's shared notice and error policy: toasts, diagnostics, storage
 * recovery, and load-failure de-duplication. Feature modules call this seam; the
 * toast host owns transient error presentation.
 */
import { t } from "../../../../../../i18n/index.ts";
import {
  setToastPolicy,
  showToast,
  type ToastContent,
} from "../../../../../../design/patterns/ToastHost.tsx";
import { loadingProgress } from "../../../../../../core/global/document/loading.ts";
import { exportAppDataBackup } from "../../../../../../core/platform/desktop/appDataBackup.ts";
import { isStorageFailure } from "../../../../../../core/platform/storageFailure.ts";
import { diagnosticText, writeDiagnosticLog } from "../../../../../platform/diagnosticLog.ts";
import { recordDiagnosticIssue } from "../../../../../../core/diagnostics/interactionLog.ts";
import {
  failurePresentationOwner,
  type FailureContext,
} from "../../../../../../core/contracts/failure.ts";
import { createFeedbackDedupe, resolveEditorFailure } from "./feedbackPolicy.ts";

/** The notice/error surface, as the assembly factories consume it. */
export type EditorFeedback = ReturnType<typeof createEditorFeedback>;

/** Shared transient notice and error-toast policy for the editor. */
export function createEditorFeedback() {
  // Completion notices are part of the editor feedback policy and are always on.
  setToastPolicy({ allowed: () => true });
  /** Shows a transient notice at the requested severity, or the full content form. */
  const notify = (content: string | ToastContent, level = "success", duration?: number): number =>
    typeof content === "string" ? showToast(content, level, duration) : showToast(content);
  /** Extracts the human-readable message from a thrown value. */
  const failureMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);
  const dedupe = createFeedbackDedupe();
  /**
   * True when the loading card already shows this exact failure, so the same
   * message is not painted again as a toast and a notice.
   */
  const alreadyOnLoadingCard = (message: string): boolean => {
    const state = loadingProgress.getSnapshot();
    return state?.status === "error" && state.error === message;
  };
  /** Logs a diagnostic and presents the failure, with storage recovery when relevant. */
  const reportError = (
    error: unknown,
    context: FailureContext = { operation: "editor.feedback" },
  ) => {
    if (error instanceof Error && error.name === "AbortError") {
      return;
    }
    const presentation = resolveEditorFailure(error, {
      operation: "editor.feedback",
      ...context,
    });
    const diagnosticSource =
      presentation.failure.source === "backend" || presentation.failure.source === "database"
        ? "backend"
        : presentation.failure.source === "native"
          ? "host"
          : "frontend";
    recordDiagnosticIssue("error", diagnosticSource, error, presentation.failure.code);
    const message = presentation.message;
    if (alreadyOnLoadingCard(message) || alreadyOnLoadingCard(failureMessage(error))) {
      return;
    }
    if (!dedupe.claim(presentation.dedupeKey)) {
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
    if (failurePresentationOwner(error) === "progress") {
      return;
    }
    if (isStorageFailure(error) || presentation.failure.kind === "storage") {
      const exportLabel = t("system.backup.exportAction");
      notify({
        message,
        level: presentation.level,
        duration: 8000,
        key: presentation.dedupeKey,
        source: "editor.feedback",
        actions: [
          {
            label: exportLabel,
            variant: "outlined",
            dismissOnSelect: false,
            onSelect: () =>
              void (async () => {
                const backupKey = `${presentation.dedupeKey}:backup`;
                try {
                  const path = await exportAppDataBackup();
                  if (path) {
                    notify({
                      message: t("system.backup.success", { path }),
                      level: "success",
                      key: backupKey,
                      source: "editor.feedback",
                    });
                  }
                } catch (backupError) {
                  notify({
                    message: t("system.backup.failed", {
                      message: failureMessage(backupError),
                    }),
                    level: "error",
                    key: backupKey,
                    source: "editor.feedback",
                  });
                }
              })(),
          },
        ],
      });
      return;
    }
    if (presentation.surface === "toast") {
      notify({
        message,
        level: presentation.level,
        duration: presentation.level === "error" ? 5000 : 6500,
        key: presentation.dedupeKey,
        source: "editor.feedback",
      });
    }
  };
  return { notify, failureMessage, reportError };
}
