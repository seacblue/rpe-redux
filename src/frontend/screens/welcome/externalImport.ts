/**
 * Imports Phigros official JSON and PhiEdit PEC charts into the local library.
 *
 * A selected file or folder is read through the native folder scanner or the
 * shared ZIP reader, converted into an RPE chart, paired with its metadata and
 * media, and written through the same library importer as an RPE chart. The
 * source file is never registered as the live document, so editing and saving
 * cannot overwrite the official/PEC original.
 */
import { localService } from "../../../core/global/library/service.ts";
import { importChartToLibrary } from "../../../core/global/library/import.ts";
import { catalogIdFor, rememberCatalogPath } from "../../../core/global/library/libraryCatalog.ts";
import { parseExternalChartText } from "../../../core/global/chart/formats/external.ts";
import type { ExternalChartMetadata } from "../../../core/global/chart/formats/common.ts";
import { parseInfo } from "../../../core/global/document/info.ts";
import type { AssetMap } from "../../../core/global/document/types.ts";
import { readZip } from "../../../core/utils/zip.ts";
import { isDesktop } from "../../../core/platform/environment.ts";
import { startLongTask, finishLongTask } from "../../../core/state/longTasks.ts";
import { t } from "../../../i18n/index.ts";
import { showToast } from "../../../design/patterns/ToastHost.tsx";
import { showImportReport } from "../../overlays/modals/importReportPrompt.ts";
import { recordImportReport, type ImportIssue, type ImportReport } from "./importReport.ts";
import {
  chooseExternalChartFile,
  readPickedBytes,
  scanExternalChart,
  type ExternalChartScan,
  type ExternalSidecar,
} from "../../platform/desktop/externalChart.ts";

/** Host callbacks the external import needs from the mounted home runtime. */
export interface ExternalImportDeps {
  reportError(error: unknown): void;
  refresh(): Promise<void>;
}

/** Sidecar metadata in the shape the converters accept. */
interface SidecarMetadata {
  metadata: ExternalChartMetadata;
  chartFile?: string;
}

/** A loaded chart and its assets, before conversion. */
interface LoadedExternalChart {
  chartPath: string;
  chartName: string;
  chartText: string;
  assets: AssetMap;
  sidecars: readonly ExternalSidecar[];
  warnings: readonly string[];
  archive: boolean;
}

const AUDIO_EXTENSIONS = /\.(?:mp3|ogg|wav|flac|m4a|aac|opus|webm)$/i;
const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|webp|gif|bmp|avif)$/i;
const CHART_EXTENSIONS = /\.(?:json|pec|txt)$/i;
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_MEDIA_BYTES = 512 * 1024 * 1024;

/** Strip a BOM and surrounding quotes from a sidecar value. */
function cleanValue(value: string | undefined): string | undefined {
  const cleaned = value?.trim().replace(/^["']|["']$/g, "");
  return cleaned || undefined;
}

/** Parse a simple `key: value` sidecar used by `info.yml` and similar files. */
function parseYamlLike(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = cleanValue(line.slice(separator + 1));
    if (key && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/** Parse PE's header/label/value `info.csv` metadata sheet. */
function parseCsvInfo(text: string): Record<string, string> {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return {};
  }
  const headers = lines[0].split(",").map((value) => value.trim().toLowerCase());
  // Some PE packages place a translated label row between the English
  // headers and the actual values; the final non-empty row is the data row.
  const values = lines
    .at(-1)!
    .split(",")
    .map((value) => value.trim());
  const result: Record<string, string> = {};
  for (const [index, header] of headers.entries()) {
    if (header && values[index]) {
      result[header] = values[index];
    }
  }
  return result;
}

/** Merge sidecars in precedence order: CSV, RPE text, then Phira YAML. */
function sidecarMetadata(sidecars: readonly ExternalSidecar[]): SidecarMetadata {
  const fields: Record<string, string> = {};
  for (const sidecar of sidecars) {
    const lower = sidecar.name.toLowerCase();
    if (lower.endsWith(".csv")) {
      Object.assign(fields, parseCsvInfo(sidecar.text));
    } else if (lower.endsWith(".txt")) {
      for (const [key, value] of Object.entries(parseInfo(sidecar.text))) {
        fields[key.toLowerCase()] = value;
      }
    } else {
      Object.assign(fields, parseYamlLike(sidecar.text));
    }
  }
  const metadata: ExternalChartMetadata = {
    name: cleanValue(fields.name),
    composer: cleanValue(fields.composer ?? fields.artist),
    charter: cleanValue(fields.charter),
    illustrator: cleanValue(fields.illustrator ?? fields.illustration),
    level: cleanValue(fields.level),
    song: cleanValue(fields.music ?? fields.song),
    // RPE Info.txt uses `Picture` for the background image and `Illustration`
    // for the artist credit. Never treat the credit as a file name.
    background: cleanValue(fields.picture ?? fields.image ?? fields.background),
  };
  const chartFile = cleanValue(fields.chart);
  return { metadata, ...(chartFile ? { chartFile } : {}) };
}

/** True when a ZIP entry is metadata rather than a chart candidate. */
function isInfoEntry(name: string): boolean {
  return /(?:^|\/)(?:info\.(?:txt|ya?ml|csv)|settings\.txt)$/i.test(name);
}

/** True when a ZIP entry is a plausible chart text. */
function isChartEntry(name: string): boolean {
  const base = name.split("/").at(-1)?.toLowerCase() ?? "";
  return (
    CHART_EXTENSIONS.test(name) &&
    !isInfoEntry(name) &&
    !/autosave_/i.test(name) &&
    base !== "extra.json" &&
    !/^(?:readme|license|changelog|credits)/i.test(base)
  );
}

/** The display stem of a chart entry, without folders or its extension. */
function chartStem(name: string): string {
  return (name.replaceAll("\\", "/").split("/").at(-1) ?? name).replace(/\.[^.]+$/, "");
}

/** Resolve a metadata media name against a known list of asset names. */
function resolveMediaName(names: readonly string[], name: string | undefined): string | undefined {
  if (!name) {
    return undefined;
  }
  const normalized = name.replaceAll("\\", "/");
  return (
    names.find((entry) => entry === normalized) ??
    names.find((entry) => entry.toLowerCase() === normalized.toLowerCase()) ??
    names.find(
      (entry) =>
        entry.split("/").at(-1)?.toLowerCase() === normalized.split("/").at(-1)?.toLowerCase(),
    )
  );
}

/** Keep the song and cover a sidecar names, or the first usable pair. */
function selectedMediaNames(
  names: readonly string[],
  metadata: ExternalChartMetadata,
  chartName?: string,
): Set<string> {
  const selected = new Set<string>();
  const stem = chartName?.replace(/\.[^.]+$/, "").toLowerCase();
  const byStem = (name: string): boolean =>
    Boolean(stem) &&
    name
      .toLowerCase()
      .split("/")
      .at(-1)
      ?.includes(stem ?? "") === true;
  const song =
    resolveMediaName(names, metadata.song) ??
    names.find((name) => AUDIO_EXTENSIONS.test(name) && byStem(name)) ??
    names.find((name) => AUDIO_EXTENSIONS.test(name));
  const background =
    resolveMediaName(names, metadata.background) ??
    names.find((name) => IMAGE_EXTENSIONS.test(name) && byStem(name)) ??
    names.find((name) => IMAGE_EXTENSIONS.test(name) && !/(?:^|\/)blur/i.test(name)) ??
    names.find((name) => IMAGE_EXTENSIONS.test(name));
  if (song) {
    selected.add(song);
  }
  if (background) {
    selected.add(background);
  }
  return selected;
}

/** Pick a chart entry from an archive, preferring the sidecar reference. */
function archiveChartName(
  entries: ReadonlyMap<string, Uint8Array>,
  sidecar: SidecarMetadata,
): string {
  if (sidecar.chartFile) {
    const reference = sidecar.chartFile.replaceAll("\\", "/");
    const direct = entries.has(reference)
      ? reference
      : [...entries.keys()].find((name) => name.toLowerCase() === reference.toLowerCase());
    if (direct) {
      return direct;
    }
  }
  const candidates = [...entries.keys()].filter(isChartEntry);
  if (candidates.length === 1) {
    return candidates[0];
  }
  if (!candidates.length) {
    throw new Error(t("workspace.welcome.external.missingChart"));
  }
  throw new Error(t("workspace.welcome.external.multipleCharts", { names: candidates.join(", ") }));
}

/** Load a chart from a ZIP archive in memory. */
async function loadArchive(path: string): Promise<LoadedExternalChart | null> {
  const bytes = await readPickedBytes(path);
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    return null;
  }
  const entries = await readZip(bytes, {
    maxEntries: 4096,
    maxEntryBytes: 512 * 1024 * 1024,
    maxTotalBytes: 1024 * 1024 * 1024,
  });
  const sidecars = [...entries]
    .filter(([name]) => isInfoEntry(name))
    .map(([name, data]) => ({ name, text: new TextDecoder().decode(data) }));
  const sidecar = sidecarMetadata(sidecars);
  const chartName = archiveChartName(entries, sidecar);
  const chartData = entries.get(chartName);
  if (!chartData) {
    throw new Error(t("workspace.welcome.external.missingChart"));
  }
  const selected = selectedMediaNames([...entries.keys()], sidecar.metadata, chartName);
  const assets: AssetMap = new Map();
  for (const [name, data] of entries) {
    if (name !== chartName && !isInfoEntry(name) && selected.has(name)) {
      assets.set(name, data);
    }
  }
  return {
    chartPath: `${path}#${chartName}`,
    chartName,
    chartText: new TextDecoder().decode(chartData),
    assets,
    sidecars,
    warnings: [],
    archive: true,
  };
}

/** Load a chart from a folder or a loose file through the native scanner. */
async function loadFolder(path: string): Promise<LoadedExternalChart> {
  const scan: ExternalChartScan = await scanExternalChart(path);
  const assets: AssetMap = new Map();
  const warnings = [...scan.warnings];
  const selected = selectedMediaNames(
    scan.media.map((media) => media.name),
    sidecarMetadata(scan.sidecars).metadata,
    scan.chartName,
  );
  let total = 0;
  for (const media of scan.media) {
    if (!selected.has(media.name)) {
      continue;
    }
    total += media.size;
    if (total > MAX_MEDIA_BYTES) {
      warnings.push(t("workspace.welcome.external.mediaLimit"));
      break;
    }
    try {
      assets.set(media.name, await readPickedBytes(media.path));
    } catch {
      warnings.push(t("workspace.welcome.external.mediaUnreadable", { name: media.name }));
    }
  }
  return {
    chartPath: scan.chartPath,
    chartName: scan.chartName,
    chartText: scan.chartText,
    assets,
    sidecars: scan.sidecars,
    warnings,
    archive: false,
  };
}

/** Resolve a metadata media name against the names the asset map actually has. */
function assetName(assets: AssetMap, name: string | undefined): string | undefined {
  return resolveMediaName([...(assets.names?.() ?? assets.keys())], name);
}

/** Fill missing song/cover references from the imported media. */
function fillMediaReferences(
  chart: { META: { song?: string; background?: string } },
  assets: AssetMap,
  metadata: ExternalChartMetadata,
): void {
  const names = [...(assets.names?.() ?? assets.keys())];
  chart.META.song =
    assetName(assets, metadata.song) ?? names.find((name) => AUDIO_EXTENSIONS.test(name)) ?? "";
  chart.META.background =
    assetName(assets, metadata.background) ??
    names.find((name) => IMAGE_EXTENSIONS.test(name)) ??
    "";
}

/** Read, convert and import one external chart path. */
export async function importExternalPath(
  path: string,
  deps: ExternalImportDeps,
): Promise<string | null> {
  if (!isDesktop()) {
    return null;
  }
  const archive = /\.(?:zip|pez)$/i.test(path);
  let loaded: LoadedExternalChart | null;
  try {
    loaded = archive ? await loadArchive(path) : await loadFolder(path);
  } catch (error) {
    // A normal RPE PEZ is not an external chart; let the native opener own it.
    if (archive) {
      return null;
    }
    throw error;
  }
  if (!loaded) {
    return null;
  }
  const sidecar = sidecarMetadata(loaded.sidecars);
  const displayName = sidecar.metadata.name ?? chartStem(loaded.chartName);
  const converted = parseExternalChartText(loaded.chartText, {
    ...sidecar.metadata,
    name: displayName,
  });
  if (!converted) {
    return null;
  }
  fillMediaReferences(converted.chart, loaded.assets, sidecar.metadata);
  const found = await localService();
  if (!found) {
    throw new Error(t("editor.app.error.libraryServiceDown"));
  }
  const warnings = [...loaded.warnings, ...converted.warnings];
  // The library write is one retained task: the notice that follows is the short
  // answer, and the row keeps the progress reachable from the task list.
  let taskId = "";
  const projectId = await new Promise<string>((resolve, reject) => {
    taskId = startLongTask({
      label: "workspace.welcome.external.title",
      detail: displayName,
      stage: t("workspace.welcome.external.importing", { name: displayName }),
      async run({ report }) {
        const existing = catalogIdFor(loaded.chartPath);
        let result: Awaited<ReturnType<typeof importChartToLibrary>>;
        try {
          result = await importChartToLibrary({
            library: found.library,
            ...(existing ? { projectId: existing } : {}),
            chart: converted.chart,
            name: displayName,
            group: converted.format === "official" ? "Phigros" : "PhiEdit",
            assets: loaded.assets,
            onProgress: (value) =>
              report(t("workspace.welcome.external.importing", { name: displayName }), value),
          });
        } catch (error) {
          // The task lifecycle records this failure; the caller keeps the
          // rejection so the import affordance can report it.
          reject(error);
          throw error;
        }
        rememberCatalogPath(loaded.chartPath, result.projectId);
        report("", 1);
        try {
          await deps.refresh();
        } catch (error) {
          deps.reportError(error);
        }
        const source = t("workspace.welcome.external.title");
        const issues: ImportIssue[] = warnings.map((detail) => ({
          scope: displayName,
          detail,
        }));
        if (issues.length) {
          const report: ImportReport = {
            projectId: result.projectId,
            title: displayName,
            source,
            issues,
          };
          recordImportReport(report);
          showToast({
            message: t("workspace.welcome.external.done", {
              name: displayName,
              warnings: warnings.length,
            }),
            level: "warning",
            actions: [
              {
                label: t("workspace.welcome.importReport.action"),
                onSelect: () => showImportReport(source, [report]),
              },
            ],
          });
        } else {
          showToast({
            message: t("workspace.welcome.external.done", {
              name: displayName,
              warnings: 0,
            }),
            level: "success",
          });
        }
        resolve(result.projectId);
      },
    });
  });
  // A failure rejects before this line; the lifecycle already recorded it as
  // failed, so reaching here means the import completed.
  finishLongTask(taskId, { status: "completed" });
  return projectId;
}

/** Ask for one external chart and import it; false when cancelled or unsupported. */
export async function chooseExternalImport(deps: ExternalImportDeps): Promise<boolean> {
  if (!isDesktop()) {
    showToast({ message: t("workspace.welcome.external.desktopOnly"), level: "warning" });
    return false;
  }
  const path = await chooseExternalChartFile();
  if (!path) {
    return false;
  }
  const projectId = await importExternalPath(path, deps);
  if (!projectId) {
    showToast({ message: t("workspace.welcome.external.notFound"), level: "warning" });
    return false;
  }
  return true;
}
