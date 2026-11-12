/**
 * Public chart-export helpers used by the editor and the library screen.
 *
 * The format writers live behind `exportPipeline.ts`: callers work with a
 * completed artifact and its conversion warnings, while the platform decides
 * whether to download it or hand it to a native save dialog.
 */
import { t } from "../../../i18n/index.ts";
import {
  createExportArtifact,
  currentChartExportAdapter,
  exportStem,
  inspectExport,
  type ChartExportFormat,
  type ExportWarning,
} from "./exportPipeline.ts";
import type { Chart } from "../chart/chart.ts";

export type { ChartExportFormat, ExportWarning } from "./exportPipeline.ts";

/** Filename stem for a chart export. */
export interface ChartExportOptions {
  name?: string;
}

/** A single-file text export ready for a download or native write. */
export interface ChartTextExport {
  text: string;
  name: string;
  mime: string;
  warnings: readonly string[];
  warningDetails: readonly ExportWarning[];
}

/** Build a PEZ export blob and its conversion report. */
export function createChartExport(
  chart: Chart,
  assets: ReadonlyMap<string, Uint8Array>,
  chartName: string,
  options: ChartExportOptions = {},
): { blob: Blob; name: string; warnings: readonly ExportWarning[] } {
  const name = options.name ?? chartName;
  if (!exportStem(name)) {
    throw new Error(t("system.files.exportNameRequired"));
  }
  const snapshot: Chart = { ...chart };
  delete snapshot.chartTime;
  const result = createExportArtifact(
    {
      model: snapshot,
      assets,
      chartName,
      name,
      format: "pez",
    },
    currentChartExportAdapter,
  );
  if (result.kind !== "binary") {
    throw new Error("The PEZ exporter produced a text artifact.");
  }
  return { blob: result.blob, name: result.name, warnings: result.warnings };
}

/** Build a single-file official JSON or PEC export and preserve structured warnings. */
export function createChartTextExport(
  chart: Chart,
  chartName: string,
  format: Exclude<ChartExportFormat, "pez">,
  options: ChartExportOptions = {},
): ChartTextExport {
  const name = options.name ?? chartName;
  if (!exportStem(name)) {
    throw new Error(t("system.files.exportNameRequired"));
  }
  const result = createExportArtifact(
    {
      model: chart,
      assets: new Map(),
      chartName,
      name,
      format,
    },
    currentChartExportAdapter,
  );
  if (result.kind !== "text") {
    throw new Error("The text exporter produced a binary artifact.");
  }
  return {
    text: result.text,
    name: result.name,
    mime: result.mime,
    warnings: result.warnings.map(({ message }) => message),
    warningDetails: result.warnings,
  };
}

/** Inspect a chart export before a native writer opens its save session. */
export function chartExportWarnings(
  chart: Chart,
  chartName: string,
  format: ChartExportFormat,
): readonly ExportWarning[] {
  return inspectExport({ model: chart, chartName, format }, currentChartExportAdapter);
}
