/**
 * The startup screen shown while the editor loads and when it cannot start.
 *
 * The failure state explains the likely cause in plain language, lists the
 * Extension evidence, shows the raw report, and offers a one-shot safe-mode
 * restart that skips every package on the next launch.
 */
import { Button } from "../../../design/components/button/Button.tsx";
import { AppIcon } from "../../../design/components/brand/AppIcon.tsx";
import { AppWordmark } from "../../../design/components/brand/AppWordmark.tsx";
import { Modal } from "../../../design/components/modal/Modal.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import type { MessageKey } from "../../../i18n/index.ts";
import { isDesktop } from "../../../core/platform/environment.ts";
import { preferences } from "../../../core/state/preferences.ts";
import { writeExtensionSafeModeRequest } from "../../../core/extensions/extensionRuntimeSupport.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { openDiagnosticLogs, writeDiagnosticLog } from "../../platform/diagnosticLog.ts";
import { getExtensionStartupState } from "../../platform/extensionLoader.ts";
import { useDocumentSurface } from "./useDocumentSurface.ts";
import {
  classifyStartupFailure,
  isBackendPortConflict,
  startupExtensionCandidates,
  startupFailureMessage,
  type StartupFailureCategory,
  type StartupFailureSource,
} from "./startupDiagnostics.ts";

/** The one-sentence explanation shown for each failure category. */
const FAILURE_DESCRIPTIONS: Record<StartupFailureCategory, MessageKey> = {
  render: "startup.failure.render",
  backend: "startup.failure.backend",
  extension: "startup.failure.extension",
  unknown: "startup.failure.unknown",
};

/** Startup screen with a loading state and a report-and-retry failure state. */
export function StartupView({
  error,
  retry,
  source = "unknown",
}: {
  error: string;
  retry: () => void;
  /** Where the error text came from, which selects the explanation. */
  source?: StartupFailureSource;
}) {
  const { t } = useTranslation();
  const surface = useDocumentSurface();
  const [writtenLog, setWrittenLog] = useState<{ report: string; path: string | null }>({
    report: "",
    path: null,
  });
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [safeModeOpen, setSafeModeOpen] = useState(false);
  const [safeModeRequested, setSafeModeRequested] = useState(false);
  const safeModeStarted = useRef(false);
  const report = useMemo(
    () =>
      error
        ? [
            t("settings.startup.reportTitle"),
            t("settings.startup.reportTime", { time: new Date().toISOString() }),
            t("settings.startup.reportRuntime", { runtime: navigator.userAgent }),
            "",
            error,
          ].join("\n")
        : "",
    [error, t],
  );
  useEffect(() => {
    if (!error) {
      return;
    }
    let active = true;
    void writeDiagnosticLog(report).then((path) => {
      if (active) {
        setWrittenLog({ report, path });
      }
    });
    return () => {
      active = false;
    };
  }, [error, report]);

  const logPath = writtenLog.report === report ? writtenLog.path : null;
  const startup = getExtensionStartupState();
  const category = classifyStartupFailure(source, startup.failures);
  const candidates = startupExtensionCandidates(startup.failures, startup.activations);
  const omitted =
    candidates.kind === "activations" ? candidates.total - candidates.items.length : 0;
  const descriptionKey = isBackendPortConflict(error)
    ? "startup.backendPortConflict.description"
    : category === "extension" && startup.safeMode
      ? "startup.failure.extensionSafeMode"
      : FAILURE_DESCRIPTIONS[category];
  /** Copies the failure report and records the outcome for the button label. */
  const copyReport = () => {
    if (!navigator.clipboard?.writeText) {
      setCopyState("failed");
      return;
    }
    void navigator.clipboard.writeText(report).then(
      () => setCopyState("copied"),
      () => setCopyState("failed"),
    );
  };

  /** Persist the one-shot request, then reload so the next pass skips Extensions. */
  const requestSafeMode = () => {
    if (safeModeStarted.current) {
      return;
    }
    safeModeStarted.current = true;
    setSafeModeRequested(true);
    writeExtensionSafeModeRequest(preferences);
    window.location.reload();
  };

  return (
    <div
      className="redux-startup"
      data-failed={error ? "true" : undefined}
      role={error ? "alert" : "status"}
      aria-live="polite"
    >
      <div className="redux-startup-card">
        <AppIcon size={72} alt="" className="redux-startup-icon" />
        <h1 className="redux-startup-title">
          <AppWordmark
            surface={surface}
            width={160}
            alt={t("common.appName")}
            className="redux-startup-wordmark"
          />
        </h1>
        <p>{error ? t(descriptionKey) : t("settings.startup.preparing")}</p>
        {!error && (
          <>
            <div className="redux-startup-progress" />
            <small>{t("settings.startup.progress")}</small>
          </>
        )}
      </div>
      {error && (
        <>
          <section
            className="redux-startup-extensions"
            aria-labelledby="redux-startup-extensions-title"
          >
            <h2 id="redux-startup-extensions-title">{t("startup.extensions.title")}</h2>
            {candidates.kind === "failures" ? (
              <>
                <p className="redux-startup-extensions-heading">
                  {t("startup.extensions.failures.title")}
                </p>
                <ul>
                  {candidates.items.map((item) => (
                    <li key={item.id}>
                      <span className="redux-startup-extension-name">{item.name}</span>
                      {item.version && <code>{item.version}</code>}
                      {"message" in item && <small>{startupFailureMessage(item.message)}</small>}
                    </li>
                  ))}
                </ul>
                <p className="redux-startup-extensions-hint">
                  {t(
                    startup.safeMode
                      ? "startup.extensions.failures.safeModeDescription"
                      : "startup.extensions.failures.description",
                  )}
                </p>
              </>
            ) : candidates.kind === "activations" ? (
              <>
                <p className="redux-startup-extensions-heading">
                  {t(
                    startup.safeMode
                      ? "startup.extensions.activations.safeModeTitle"
                      : "startup.extensions.activations.title",
                  )}
                </p>
                <ul>
                  {candidates.items.map((item) => (
                    <li key={item.id}>
                      <span className="redux-startup-extension-name">{item.name}</span>
                      {item.version && <code>{item.version}</code>}
                    </li>
                  ))}
                </ul>
                <p className="redux-startup-extensions-hint">
                  {t(
                    startup.safeMode
                      ? "startup.extensions.activations.safeModeDescription"
                      : "startup.extensions.activations.description",
                  )}
                </p>
                {omitted > 0 && (
                  <p className="redux-startup-extensions-hint">
                    {t("startup.extensions.more", { count: omitted })}
                  </p>
                )}
              </>
            ) : (
              <p className="redux-startup-extensions-hint">{t("startup.extensions.none")}</p>
            )}
          </section>
          <section className="redux-startup-report-details">
            <pre className="redux-startup-report">{report}</pre>
          </section>
          {logPath ? (
            <div className="redux-startup-log-guide">
              <p>{t("settings.startup.logGuide")}</p>
              <code>{t("settings.startup.logPath", { path: logPath })}</code>
            </div>
          ) : (
            <div className="redux-startup-log-guide">
              <p>{t("settings.startup.logUnavailable")}</p>
            </div>
          )}
          <div className="redux-startup-actions">
            {!startup.safeMode && (
              <Button
                variant="outlined"
                disabled={safeModeRequested}
                aria-haspopup="dialog"
                onClick={() => setSafeModeOpen(true)}
              >
                {t("startup.safeMode.open")}
              </Button>
            )}
            <Button variant="outlined" onClick={copyReport}>
              {copyState === "copied"
                ? t("settings.startup.copySuccess")
                : copyState === "failed"
                  ? t("settings.startup.copyFailed")
                  : t("settings.startup.copyReport")}
            </Button>
            {isDesktop() && (
              <Button variant="outlined" onClick={() => void openDiagnosticLogs()}>
                {t("settings.startup.openLogs")}
              </Button>
            )}
            <Button
              variant="solid"
              onClick={() => {
                retry();
              }}
            >
              {t("settings.startup.retry")}
            </Button>
          </div>
          <Modal
            open={safeModeOpen}
            onClose={() => setSafeModeOpen(false)}
            priority={20}
            label={t("startup.safeMode.title")}
            description={t("startup.safeMode.description")}
            role="alertdialog"
            closeButton={false}
            className="redux-startup-safe-mode"
            actions={
              <>
                <Button variant="outlined" onClick={() => setSafeModeOpen(false)}>
                  {t("common.action.cancel")}
                </Button>
                <Button variant="solid" disabled={safeModeRequested} onClick={requestSafeMode}>
                  {t("startup.safeMode.confirm")}
                </Button>
              </>
            }
          />
        </>
      )}
    </div>
  );
}
