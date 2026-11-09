/**
 * Developer-only settings, shown after the help page's reveal gesture.
 *
 * It owns the runtime environment summary, a one-click copy of that summary,
 * and the performance HUD switch. Developer commands stay on their shortcuts
 * instead of duplicating as buttons.
 */
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "../../../../design/components/button/Button.tsx";
import { FieldRow } from "../../../../design/components/field/FieldRow.tsx";
import { Icon } from "../../../../design/components/icon/Icon.tsx";
import { Input } from "../../../../design/components/input/Input.tsx";
import { showToast } from "../../../../design/patterns/ToastHost.tsx";
import { LANGUAGE_NAMES } from "../../../../i18n/index.ts";
import { useTranslation } from "../../../../i18n/react.ts";
import { isDesktop } from "../../../../core/platform/environment.ts";
import { developerMode } from "../../../../core/platform/desktop/developer.ts";
import { developerNoteBorders } from "../../../../core/state/developerNoteBorders.ts";
import { developerReveal, isDeveloperRevealed } from "../../../../core/state/developerReveal.ts";
import { getTheme } from "../../../../core/theme/themes.ts";
import { packageName } from "../../../../core/utils/packageName.ts";
import { exportDiagnosticBundle } from "../../../platform/diagnosticBundle.ts";
import {
  loadDeveloperEnvironment,
  type DeveloperEnvironment,
} from "../../../platform/developerEnvironment.ts";
import { registerSettingsPage, type SettingsPageContext } from "../settingsContributions.ts";
import {
  isPerformanceHudEnabled,
  performanceHudEnabled,
  togglePerformanceHud,
} from "../../../overlays/performance/performanceHud.ts";

/** Subscribe to both gates that decide why the developer section is open. */
function subscribeDeveloperSource(listener: () => void): () => void {
  const disposeMode = developerMode.subscribe(listener);
  const disposeReveal = developerReveal.subscribe(listener);
  return () => {
    disposeMode();
    disposeReveal();
  };
}

/** A stable two-flag snapshot for the developer source row. */
function developerSourceKey(): string {
  return `${developerMode.get() ? "1" : "0"}${isDeveloperRevealed() ? "1" : "0"}`;
}

/**
 * Copy text through the async clipboard API, falling back to the hidden
 * selection command when the host denies clipboard-write.
 */
async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Some hosts deny clipboard-write without a trusted user gesture.
    }
  }
  if (typeof document === "undefined") {
    return false;
  }
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement("textarea");
  area.className = "redux-developer-copy-sink";
  area.value = text;
  area.readOnly = true;
  document.body.append(area);
  area.select();
  let copied: boolean;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    area.remove();
    previous?.focus();
  }
  return copied;
}

/** Developer-only settings mounted after the help logo reveal. */
export function DeveloperSettings({ theme }: SettingsPageContext) {
  const { t, language } = useTranslation();
  const [environment, setEnvironment] = useState<DeveloperEnvironment | null>(null);
  const [exportingBundle, setExportingBundle] = useState(false);
  const performanceHudEnabledValue = useSyncExternalStore(
    performanceHudEnabled.subscribe,
    isPerformanceHudEnabled,
    isPerformanceHudEnabled,
  );
  const noteBordersEnabled = useSyncExternalStore(
    developerNoteBorders.subscribe,
    developerNoteBorders.get,
    developerNoteBorders.get,
  );
  const developerSource = useSyncExternalStore(
    subscribeDeveloperSource,
    developerSourceKey,
    developerSourceKey,
  );
  const developerTitleId = useId();
  const environmentTitleId = useId();

  useEffect(() => {
    let cancelled = false;
    void loadDeveloperEnvironment().then((next) => {
      if (!cancelled) {
        setEnvironment(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const themeDefinition = getTheme(theme);
  const themeDetail = themeDefinition
    ? themeDefinition.id === themeDefinition.appearance
      ? themeDefinition.id
      : `${themeDefinition.id} · ${themeDefinition.appearance}`
    : theme;
  const themeValue = themeDefinition
    ? `${packageName(themeDefinition.name, language)} (${themeDetail})`
    : theme;
  const hostDeveloperMode = developerSource[0] === "1";
  const revealed = developerSource[1] === "1";
  const modeLabels: string[] = [];
  if (hostDeveloperMode) {
    modeLabels.push(
      isDesktop()
        ? t("settings.help.developer.environment.mode.host")
        : t("settings.help.developer.environment.mode.browser"),
    );
  }
  if (revealed) {
    modeLabels.push(t("settings.help.developer.environment.mode.reveal"));
  }
  const modeValue =
    modeLabels.length > 0
      ? modeLabels.join(" + ")
      : t("settings.help.developer.environment.mode.standard");
  const channelValue =
    environment?.channel === "beta"
      ? t("settings.help.developer.environment.channel.beta")
      : environment?.channel === "development"
        ? t("settings.help.developer.environment.channel.development")
        : t("settings.help.developer.environment.channel.stable");
  const notDetected = t("settings.help.developer.environment.notDetected");
  const loading = "…";
  const rows = useMemo(
    () => [
      {
        id: "version",
        label: t("settings.help.developer.environment.version"),
        value: environment?.version ?? loading,
      },
      {
        id: "channel",
        label: t("settings.help.developer.environment.channel"),
        value: environment ? channelValue : loading,
      },
      {
        id: "tauri",
        label: t("settings.help.developer.environment.tauri"),
        value: environment ? (environment.tauri ?? notDetected) : loading,
      },
      {
        id: "webview",
        label: t("settings.help.developer.environment.webview"),
        value: environment ? (environment.webview ?? notDetected) : loading,
      },
      {
        id: "chromium",
        label: t("settings.help.developer.environment.chromium"),
        value: environment ? (environment.chromium ?? notDetected) : loading,
      },
      {
        id: "system",
        label: t("settings.help.developer.environment.system"),
        value: environment?.system ?? loading,
      },
      {
        id: "gpu",
        label: t("settings.help.developer.environment.gpu"),
        value: environment ? (environment.gpu ?? notDetected) : loading,
      },
      {
        id: "theme",
        label: t("settings.help.developer.environment.theme"),
        value: themeValue,
      },
      {
        id: "language",
        label: t("settings.help.developer.environment.language"),
        value: `${LANGUAGE_NAMES[language]} (${language})`,
      },
      {
        id: "dataDirectory",
        label: t("settings.help.developer.environment.dataDirectory"),
        value: environment
          ? (environment.dataDirectory ??
            (isDesktop() ? notDetected : t("settings.help.developer.environment.noBrowserData")))
          : loading,
      },
      {
        id: "developerMode",
        label: t("settings.help.developer.environment.developerMode"),
        value: modeValue,
      },
    ],
    [environment, t, channelValue, notDetected, themeValue, language, modeValue],
  );

  /** Ask the host for a zip destination and write the diagnostic bundle there. */
  const exportBundle = async (): Promise<void> => {
    if (exportingBundle) {
      return;
    }
    setExportingBundle(true);
    try {
      const path = await exportDiagnosticBundle();
      if (path) {
        showToast({
          message: t("settings.help.developer.exportBundleSuccess", { path }),
          level: "success",
        });
      }
    } catch (error) {
      showToast({
        message: t("settings.help.developer.exportBundleFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
        level: "error",
      });
    } finally {
      setExportingBundle(false);
    }
  };

  /** Copy the rendered summary as plain text. */
  const copySummary = (): void => {
    if (!environment) {
      return;
    }
    const text = rows.map((row) => `${row.label}: ${row.value}`).join("\n");
    void copyText(text).then((copied) => {
      showToast({
        message: copied
          ? t("settings.help.developer.copySucceeded")
          : t("settings.help.developer.copyFailed"),
        level: copied ? "success" : "error",
      });
    });
  };

  return (
    <section
      className="redux-setting-group redux-developer-settings"
      aria-labelledby={developerTitleId}
    >
      <h3 id={developerTitleId}>{t("settings.help.developer.title")}</h3>
      <FieldRow
        className="redux-setting"
        data-control="toggle"
        htmlFor="performance-hud-enabled"
        label={t("settings.help.developer.performanceHud")}
        description={t("settings.help.developer.performanceHudHint")}
        control={
          <Input
            id="performance-hud-enabled"
            type="checkbox"
            checked={performanceHudEnabledValue}
            onChange={togglePerformanceHud}
          />
        }
      />
      <FieldRow
        className="redux-setting"
        data-control="toggle"
        htmlFor="developer-note-borders"
        label={t("settings.help.developer.noteBorders")}
        description={t("settings.help.developer.noteBordersHint")}
        control={
          <Input
            id="developer-note-borders"
            type="checkbox"
            checked={noteBordersEnabled}
            onChange={(event) => developerNoteBorders.set(event.currentTarget.checked)}
          />
        }
      />
      <FieldRow
        className="redux-setting"
        htmlFor="export-diagnostic-bundle"
        label={t("settings.help.developer.exportBundle")}
        description={
          isDesktop()
            ? t("settings.help.developer.exportBundleHint")
            : `${t("settings.help.developer.exportBundleHint")} ${t(
                "settings.help.developer.exportBundleDesktopOnly",
              )}`
        }
        control={
          <Button
            id="export-diagnostic-bundle"
            variant="outlined"
            iconText
            disabled={!isDesktop() || exportingBundle}
            title={!isDesktop() ? t("settings.help.developer.exportBundleDesktopOnly") : undefined}
            onClick={() => void exportBundle()}
          >
            <Icon name="export" size={16} />
            <span className="redux-button-label">
              {exportingBundle
                ? t("settings.help.developer.exportBundleBusy")
                : t("settings.help.developer.exportBundle")}
            </span>
          </Button>
        }
      />
      <hr className="redux-developer-divider" />
      <section className="redux-developer-environment" aria-labelledby={environmentTitleId}>
        <h4 id={environmentTitleId}>{t("settings.help.developer.environment.title")}</h4>
        <dl className="redux-developer-environment-list">
          {rows.map((row) => (
            <div className="redux-developer-environment-row" key={row.id}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="redux-developer-environment-footer">
          <Button variant="outlined" iconText disabled={!environment} onClick={copySummary}>
            <Icon name="copy" size={16} />
            <span className="redux-button-label">{t("settings.help.developer.copySummary")}</span>
          </Button>
        </div>
      </section>
    </section>
  );
}

registerSettingsPage("developer", {
  keywords: "settings.search.developerKeywords",
  component: DeveloperSettings,
});
