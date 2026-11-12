/**
 * The export question and its submit path.
 *
 * Owns the queued prompt, the default name, and the call into the core exporter;
 * the dialog only renders what this module publishes.
 */
import { t } from "../../../../../../i18n/index.ts";
import {
  createChartExport,
  createChartTextExport,
  chartExportWarnings,
  type ChartExportFormat,
  type ExportWarning,
} from "../../../../../../core/global/document/export.ts";
import { download } from "../../../../../platform/download.ts";
import { currentDocumentStore } from "../../../../../platform/documentStoreHandle.ts";
import { createModalRequests } from "../../../../../overlays/modals/requests.ts";
import { requestConfirm } from "../../../../../overlays/modals/prompts.ts";
import type { AssetMap } from "../../../../../../core/global/document/types.ts";
import type { Chart } from "../../../../../../core/global/chart/chart.ts";

/** Starting values for the export question. */
export interface ExportPromptOptions {
  name: string;
  format: ChartExportFormat;
}

/** Writes one answer to the export question; null means the save was cancelled. */
export type ExportWriter = (options: ExportPromptOptions) => Promise<string | null>;

/**
 * The export question, waiting on its answer.
 *
 * `submit` owns the dialog lifecycle and the write, so the view only renders
 * the answer fields and reports the action state.
 */
export interface ExportPrompt {
  /** Identifies this request; a fresh one remounts the dialog, so its fields start clean. */
  id: number;
  title: string;
  /** Starting values: the name already in use and the default container. */
  initial: ExportPromptOptions;
  submit(options: ExportPromptOptions): Promise<void>;
}

/** Strips the folder and chart-file extension from a document name. */
function initialName(chartName: string): string {
  return (chartName.replaceAll("\\", "/").split("/").at(-1) ?? "").replace(
    /\.(json|pec|pez|zip)$/i,
    "",
  );
}

/** Writes one chart through the native store or a browser download. */
async function exportChart(
  chart: Chart,
  assets: AssetMap,
  chartName: string,
  options: ExportPromptOptions,
): Promise<string | null> {
  const { name, format } = options;
  const native = currentDocumentStore();
  if (format === "pez") {
    if (!(await confirmExportWarnings(format, chartExportWarnings(chart, chartName, format)))) {
      return null;
    }
    if (native) {
      const result = await native.export(chart, assets, {
        format: "pez",
        name: `${name}.pez`,
      });
      return result?.path ?? null;
    }
    const result = createChartExport(chart, assets, chartName, { name });
    if (!(await confirmExportWarnings(format, result.warnings))) {
      return null;
    }
    download(result.blob, result.name);
    return result.name;
  }
  const result = createChartTextExport(chart, chartName, format, { name });
  if (!(await confirmExportWarnings(format, result.warningDetails))) {
    return null;
  }
  if (native) {
    return native.exportText(result.text, {
      name: result.name,
      extension: format === "official" ? "json" : "pec",
      filter: t(
        format === "official" ? "system.document.officialFilter" : "system.document.pecFilter",
      ),
    });
  }
  download(new Blob([result.text], { type: result.mime }), result.name);
  return result.name;
}

/** Ask for confirmation when the conversion reports target-format loss. */
export async function confirmExportWarnings(
  format: ChartExportFormat,
  warnings: readonly ExportWarning[],
): Promise<boolean> {
  if (!warnings.length) {
    return true;
  }
  const label =
    format === "pez"
      ? t("editor.dialogs.exportDialog.formatPez")
      : format === "official"
        ? t("editor.dialogs.exportDialog.formatOfficial")
        : t("editor.dialogs.exportDialog.formatPec");
  return requestConfirm({
    title: t("editor.dialogs.exportDialog.lossWarningTitle"),
    description: t("editor.dialogs.exportDialog.lossWarningDescription", {
      format: label,
      count: warnings.length,
    }),
    label: t("editor.dialogs.exportDialog.exportAnyway"),
    cancelLabel: t("workspace.dialogs.dismiss"),
  });
}

/**
 * Asks for the export container, then writes the chart.
 *
 * `writer` overrides the mounted-document path for callers that export a
 * detached chart, such as a library project on the home screen.
 */
export function showExportDialog(
  chart: Chart,
  assets: AssetMap,
  chartName: string,
  onExport: (name: string) => void,
  writer?: ExportWriter,
): void {
  exportPrompt.show(chart, assets, chartName, onExport, writer);
}

/** Creates the shared export prompt and its queued requests. */
function createExportPrompt() {
  const prompt = createModalRequests<ExportPrompt>("export");
  let nextId = 0;

  /** Enqueues one export question for the given chart snapshot. */
  function show(
    chart: Chart,
    assets: AssetMap,
    chartName: string,
    onExport: (name: string) => void,
    writer?: ExportWriter,
  ): void {
    nextId += 1;
    prompt.enqueue({
      id: nextId,
      title: t("editor.dialogs.exportDialog.title"),
      initial: { name: initialName(chartName), format: "pez" },
      submit: async (options) => {
        const name = await (writer ?? ((value) => exportChart(chart, assets, chartName, value)))(
          options,
        );
        if (name === null) {
          // A cancelled native save keeps the question up for another attempt.
          return;
        }
        prompt.close();
        onExport(name);
      },
    });
  }

  return {
    get: prompt.get,
    subscribe: prompt.subscribe,
    show,
    close: prompt.close,
  };
}

const exportPrompt = createExportPrompt();

/** The pending export question, if any. */
export const getExportPrompt = exportPrompt.get;
/** Subscribes to export-question changes. */
export const subscribeExportPrompt = exportPrompt.subscribe;

/**
 * Takes the question down. The view calls this when the file has been written,
 * and when the dialog is dismissed unanswered.
 */
export function closeExportPrompt(): void {
  exportPrompt.close();
}
