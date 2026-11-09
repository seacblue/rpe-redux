/**
 * Collects the diagnostic bundle report and asks the desktop host to write it.
 *
 * The frontend supplies the redacted runtime snapshot, extension inventory,
 * chart summary, and environment facts. The host adds bounded recent logs and
 * writes one zip so a maintainer receives a single support artifact.
 */
import { invoke } from "@tauri-apps/api/core";
import { chart } from "../../core/api/chart.ts";
import { captureDiagnosticsSnapshot } from "../../core/diagnostics/snapshot.ts";
import { getDocumentApi, type DocumentState } from "../../core/edit/document/api.ts";
import { extensionRuntime } from "../../core/extensions/extensionRuntime.ts";
import { isDesktop } from "../../core/platform/environment.ts";
import { developerMode } from "../../core/platform/desktop/developer.ts";
import { dialogDefaultPath, rememberDialogFile } from "../../core/platform/desktop/dialogPath.ts";
import { isDeveloperRevealed } from "../../core/state/developerReveal.ts";
import { activeTheme } from "../../core/theme/activeTheme.ts";
import { getTheme } from "../../core/theme/themes.ts";
import { packageName } from "../../core/utils/packageName.ts";
import { getLanguage, t } from "../../i18n/index.ts";
import { loadDeveloperEnvironment } from "./developerEnvironment.ts";

/** A local timestamp suitable for a file name. */
function fileStamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  ].join("-");
}

/** Count the event arrays in one event layer. */
function countLayerEvents(layer: unknown): number {
  if (!layer || typeof layer !== "object") {
    return 0;
  }
  let count = 0;
  for (const value of Object.values(layer as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      count += value.length;
    }
  }
  return count;
}

/** A path-free document summary for the bundle. */
function documentSummary(state: DocumentState | null): unknown {
  if (!state) {
    return null;
  }
  return {
    status: state.status,
    name: state.name,
    format: state.format,
    dirty: state.dirty,
    fingerprint: state.fingerprint,
  };
}

/** Environment facts that are not part of the cached host probe. */
async function environmentSummary(): Promise<unknown> {
  const environment = await loadDeveloperEnvironment();
  const language = getLanguage();
  const theme = activeTheme();
  const definition = getTheme(theme);
  return {
    ...environment,
    theme: definition
      ? {
          id: definition.id,
          name: packageName(definition.name, language),
          appearance: definition.appearance,
        }
      : { id: theme },
    language,
    desktop: isDesktop(),
    developerMode: {
      host: developerMode.get(),
      revealed: isDeveloperRevealed(),
    },
  };
}

/** Installed packages with only the facts a maintainer needs. */
function extensionSummary(): unknown {
  return extensionRuntime.list().map((extension) => ({
    id: extension.manifest.id,
    name: extension.manifest.name,
    version: extension.manifest.version,
    status: extension.status,
    source: extension.source,
    content: extension.content,
    trustState: extension.trustState,
    consent: extension.consent,
    collaboration: extension.manifest.collaboration ?? "local",
    capabilities: extension.manifest.capabilities ?? [],
    failureCount: extension.failureCount,
  }));
}

/** Metadata and object counts for the open chart; the chart body stays out. */
function chartSummary(): unknown {
  const documentState = getDocumentApi()?.state() ?? null;
  const apiState = chart.state();
  const snapshot = chart.snapshot();
  if (!snapshot.ok) {
    return {
      open: false,
      document: documentSummary(documentState),
      error: snapshot.error,
    };
  }
  const value = snapshot.value;
  if (!value) {
    return { open: false, document: documentSummary(documentState) };
  }
  const lines = value.judgeLineList ?? [];
  let noteCount = 0;
  let eventCount = 0;
  for (const line of lines) {
    noteCount += line.notes?.length ?? 0;
    for (const layer of [...(line.eventLayers ?? []), line.extended]) {
      eventCount += countLayerEvents(layer);
    }
  }
  const meta = value.META ?? {};
  return {
    open: true,
    document: documentSummary(documentState),
    fingerprint: apiState.ok ? apiState.value.chartFingerprint : null,
    generation: apiState.ok ? apiState.value.generation : null,
    metadata: {
      name: meta.name ?? null,
      composer: meta.composer ?? null,
      charter: meta.charter ?? null,
      illustration: meta.illustration ?? null,
      level: meta.level ?? null,
      song: meta.song ?? null,
      offset: meta.offset ?? null,
      rpeVersion: meta.RPEVersion ?? null,
      reduxVersion: meta.ReduxVersion ?? null,
      id: meta.id ?? null,
    },
    counts: {
      lines: lines.length,
      notes: noteCount,
      events: eventCount,
      bpmEntries: value.BPMList?.length ?? 0,
      blockAreas: value.blockAreaList?.length ?? 0,
    },
  };
}

/** Build the JSON report the host writes beside the recent logs. */
export async function collectDiagnosticReport(): Promise<Record<string, unknown>> {
  return {
    environment: await environmentSummary(),
    diagnostics: captureDiagnosticsSnapshot(),
    extensions: extensionSummary(),
    chart: chartSummary(),
  };
}

/**
 * Ask for a destination and write the diagnostic bundle there.
 *
 * Returns the written path, or null when the save dialog is cancelled. The host
 * rejects a destination outside an existing directory or without a zip suffix.
 */
export async function exportDiagnosticBundle(): Promise<string | null> {
  if (!isDesktop()) {
    throw new Error(t("settings.help.developer.exportBundleDesktopOnly"));
  }
  const path = await (
    await import("@tauri-apps/plugin-dialog")
  ).save({
    defaultPath: dialogDefaultPath("diagnostics", `RPE-Redux-diagnostics-${fileStamp()}.zip`),
    filters: [{ name: t("system.diagnostics.fileType"), extensions: ["zip"] }],
  });
  if (!path) {
    return null;
  }
  rememberDialogFile("diagnostics", path);
  const report = await collectDiagnosticReport();
  return invoke<string>("export_diagnostic_bundle", { path, report });
}
