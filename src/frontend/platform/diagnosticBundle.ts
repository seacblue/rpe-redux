/**
 * Collects the diagnostic bundle report and asks the desktop host to write it.
 *
 * The frontend supplies the redacted runtime snapshot, extension inventory,
 * chart summary, and environment facts. The host adds bounded recent logs and
 * writes one zip so a maintainer receives a single support artifact.
 */
import { invoke } from "@tauri-apps/api/core";
import { chart } from "../../core/api/chart.ts";
import { playback } from "../../core/api/playback.ts";
import { preview } from "../../core/api/preview.ts";
import { captureDiagnosticsSnapshot } from "../../core/diagnostics/snapshot.ts";
import { interactionDiagnosticsSnapshot } from "../../core/diagnostics/interactionLog.ts";
import { redactDiagnosticText, redactDiagnosticValue } from "../../core/diagnostics/redaction.ts";
import { renderDiagnosticsSnapshot } from "../../core/diagnostics/renderMetrics.ts";
import { getDocumentApi, type DocumentState } from "../../core/edit/document/api.ts";
import type { PreviewSnapshot } from "../../core/edit/preview/api.ts";
import { collectChartDiagnostics } from "../../core/global/chart/diagnostics.ts";
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
    namePresent: Boolean(state.name),
    nameLength: state.name.length,
    format: state.format,
    dirty: state.dirty,
    fingerprint: state.fingerprint,
  };
}

/** Environment facts that are not part of the cached host probe. */
async function environmentSummary(): Promise<unknown> {
  const environment = await loadDeveloperEnvironment();
  const { dataDirectory, ...safeEnvironment } = environment;
  const language = getLanguage();
  const theme = activeTheme();
  const definition = getTheme(theme);
  return {
    ...safeEnvironment,
    dataDirectory: { configured: Boolean(dataDirectory) },
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
    recentErrors: extension.recentErrors.slice(-3).map(redactDiagnosticText),
    provenance: {
      sourceUrl: Boolean(extension.provenance.sourceUrl),
      homepage: Boolean(extension.provenance.homepage),
      repository: Boolean(extension.provenance.repository),
      author: Boolean(extension.provenance.author),
    },
  }));
}

/** Keep only stable scalar chart metadata and presence/length information. */
function safeChartMetadata(meta: Record<string, unknown>): unknown {
  const textFields = ["name", "composer", "charter", "illustration", "song"] as const;
  const present: Record<string, boolean> = {};
  const lengths: Record<string, number> = {};
  for (const field of textFields) {
    const value = meta[field];
    present[field] = typeof value === "string" && value.length > 0;
    lengths[field] = typeof value === "string" ? value.length : 0;
  }
  const scalar = (value: unknown): string | number | boolean | null =>
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? value
      : null;
  return {
    present,
    lengths,
    level: scalar(meta.level),
    offset: scalar(meta.offset),
    rpeVersion: scalar(meta.RPEVersion),
    reduxVersion: scalar(meta.ReduxVersion),
  };
}

/** Summarize chart validation findings without including authored values. */
function chartIssueSummary(value: unknown): unknown {
  const byCategory: Record<string, number> = {};
  const byMessage: Record<string, number> = {};
  for (const issue of collectChartDiagnostics(value)) {
    byCategory[issue.category] = (byCategory[issue.category] ?? 0) + 1;
    byMessage[issue.messageKey] = (byMessage[issue.messageKey] ?? 0) + 1;
  }
  return {
    total: Object.values(byCategory).reduce((total, count) => total + count, 0),
    byCategory,
    byMessage,
  };
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
      error: redactDiagnosticValue(snapshot.error),
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
    metadata: safeChartMetadata(meta as Record<string, unknown>),
    counts: {
      lines: lines.length,
      notes: noteCount,
      events: eventCount,
      bpmEntries: value.BPMList?.length ?? 0,
      blockAreas: value.blockAreaList?.length ?? 0,
    },
    issues: chartIssueSummary(value),
  };
}

/** Convert a preview snapshot into frame geometry counters without chart data. */
function previewSnapshotSummary(snapshot: PreviewSnapshot): unknown {
  const byKind = { judgeLine: 0, note: 0, hold: 0 };
  for (const object of snapshot.objects) {
    byKind[object.kind] += 1;
  }
  return {
    revision: snapshot.revision,
    seconds: snapshot.seconds,
    canvas: {
      width: snapshot.width,
      height: snapshot.height,
      devicePixelRatio: snapshot.devicePixelRatio,
      scale: snapshot.scale,
      scaleX: snapshot.scaleX,
      scaleY: snapshot.scaleY,
    },
    bounds: snapshot.bounds,
    viewport: snapshot.viewport,
    objects: { total: snapshot.objects.length, byKind },
  };
}

/** Keep a renderer canvas label only when it is a stable non-user identifier. */
function safeCanvasLabel(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9._-]{1,64}$/i.test(value) ? value : "[redacted]";
}

/** Summarize recent playback frames and texture readiness without image data. */
function playbackFrameSummary(): unknown {
  const frames = playback.frames();
  if (!frames.ok) {
    return { available: false, errorCode: frames.error.code };
  }
  const textures = playback.textures();
  const textureSummary = textures.ok
    ? {
        total: textures.value.length,
        decoded: textures.value.filter((texture) => texture.decoded).length,
        pending: textures.value.filter((texture) => texture.pending).length,
        failed: textures.value.filter((texture) => texture.failed).length,
        bytes: textures.value.reduce((total, texture) => total + texture.bytes, 0),
      }
    : { total: 0, decoded: 0, pending: 0, failed: 0, bytes: 0 };
  return {
    available: true,
    recent: frames.value.slice(-8).map((frame) => ({
      canvas: safeCanvasLabel(frame.canvas),
      seconds: frame.seconds,
      width: frame.width,
      height: frame.height,
      scale: frame.scale,
      lines: frame.lines.length,
      notes: frame.notes.length,
    })),
    textures: textureSummary,
  };
}

/** Summarize the visible preview frame without exporting chart pixels. */
function frameSummary(): unknown {
  const snapshot = preview.snapshot();
  if (!snapshot.ok) {
    return {
      available: false,
      errorCode: snapshot.error.code,
      playback: playbackFrameSummary(),
    };
  }
  if (!snapshot.value) {
    return { available: false, reason: "no_visible_preview", playback: playbackFrameSummary() };
  }
  return {
    available: true,
    preview: previewSnapshotSummary(snapshot.value),
    playback: playbackFrameSummary(),
  };
}

/** Build the JSON report the host writes beside the recent logs. */
export async function collectDiagnosticReport(): Promise<Record<string, unknown>> {
  const interaction = interactionDiagnosticsSnapshot();
  return {
    environment: await environmentSummary(),
    diagnostics: captureDiagnosticsSnapshot(),
    extensions: extensionSummary(),
    chart: chartSummary(),
    renderer: renderDiagnosticsSnapshot(),
    frame: frameSummary(),
    actions: {
      sequence: interaction.actions,
      dropped: interaction.droppedActions,
      capacity: interaction.capacities.actions,
    },
    issues: {
      frontend: interaction.issues,
      dropped: interaction.droppedIssues,
      capacity: interaction.capacities.issues,
    },
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
