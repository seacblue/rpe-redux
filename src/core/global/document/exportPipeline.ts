/**
 * Converts an editor model into a target-file artifact.
 *
 * The editor currently stores the RPE chart shape directly, so the default
 * adapter only projects native defaults. A future authoring model can provide
 * another adapter without making PEZ, official JSON, or PEC writers aware of
 * that model. Warnings travel with the conversion result so the UI can ask for
 * confirmation before a lossy file is written.
 */
import { type Chart } from "../chart/chart.ts";
import { projectChartForExport } from "../chart/exportProjection.ts";
import { serializeOfficialChart } from "../chart/formats/official.ts";
import { serializePecChart } from "../chart/formats/pec.ts";
import { writeZip } from "../../utils/zip.ts";
import { packageEntries } from "./package.ts";

/** The file formats offered by the export dialog. */
export type ChartExportFormat = "pez" | "official" | "pec";

/** One user-visible fact that the target format cannot preserve exactly. */
export interface ExportWarning {
  readonly code: string;
  readonly message: string;
}

/** The RPE-shaped intermediate model consumed by the target writers. */
export interface ExportConversion {
  readonly chart: Chart;
  readonly warnings: readonly ExportWarning[];
}

/** Context supplied to an editor-model adapter before target serialization. */
export interface ExportConversionContext {
  readonly chartName: string;
}

/** Converts an authoring model into the stable RPE export intermediate model. */
export interface ExportModelAdapter<TModel> {
  convert(model: TModel, context: ExportConversionContext): ExportConversion;
}

/** The current editor chart adapter; kept as a seam for a future authoring model. */
export const currentChartExportAdapter: ExportModelAdapter<Chart> = Object.freeze({
  convert(chart: Chart, context: ExportConversionContext) {
    return {
      chart: projectChartForExport(chart, context.chartName),
      warnings: [],
    };
  },
});

/** Inputs shared by binary and text writers. */
export interface ExportArtifactRequest<TModel> {
  readonly model: TModel;
  readonly assets: ReadonlyMap<string, Uint8Array>;
  readonly chartName: string;
  readonly name: string;
  readonly format: ChartExportFormat;
}

/** A fully prepared export, before the platform chooses where to write it. */
export type ExportArtifact =
  | {
      readonly kind: "binary";
      readonly format: "pez";
      readonly blob: Blob;
      readonly name: string;
      readonly mime: string;
      readonly warnings: readonly ExportWarning[];
    }
  | {
      readonly kind: "text";
      readonly format: "official" | "pec";
      readonly text: string;
      readonly name: string;
      readonly mime: string;
      readonly warnings: readonly ExportWarning[];
    };

/** Remove a known chart extension and characters Windows rejects in filenames. */
export function exportStem(name: string): string {
  return name
    .trim()
    .replace(/\.(json|pec|pez|zip)$/i, "")
    .replace(/[\\/:*?"<>|]/g, "_");
}

/** Wrap legacy string diagnostics from an external serializer in the pipeline contract. */
function formatWarnings(format: Exclude<ChartExportFormat, "pez">, warnings: readonly string[]) {
  return warnings.map((message, index) => ({
    code: `${format}.loss.${index + 1}`,
    message,
  }));
}

/** Convert a model and inspect format loss without creating a package or writing a file. */
export function inspectExport<TModel>(
  request: Omit<ExportArtifactRequest<TModel>, "assets" | "name">,
  adapter: ExportModelAdapter<TModel>,
): readonly ExportWarning[] {
  const conversion = adapter.convert(request.model, { chartName: request.chartName });
  if (request.format === "pez") {
    return conversion.warnings;
  }
  const result =
    request.format === "official"
      ? serializeOfficialChart(conversion.chart)
      : serializePecChart(conversion.chart);
  return [...conversion.warnings, ...formatWarnings(request.format, result.warnings)];
}

/** Build the target artifact after the model-to-RPE conversion has completed. */
export function createExportArtifact<TModel>(
  request: ExportArtifactRequest<TModel>,
  adapter: ExportModelAdapter<TModel>,
): ExportArtifact {
  const conversion = adapter.convert(request.model, { chartName: request.chartName });
  const stem = exportStem(request.name);
  if (!stem) {
    throw new Error("An export file name is required.");
  }
  if (request.format === "pez") {
    return {
      kind: "binary",
      format: "pez",
      blob: writeZip(
        packageEntries(conversion.chart, request.assets, request.chartName, { projected: true }),
      ),
      name: `${stem}.pez`,
      mime: "application/zip",
      warnings: conversion.warnings,
    };
  }
  const result =
    request.format === "official"
      ? serializeOfficialChart(conversion.chart)
      : serializePecChart(conversion.chart);
  return {
    kind: "text",
    format: request.format,
    text: result.text,
    name: `${stem}.${request.format === "official" ? "json" : "pec"}`,
    mime: request.format === "official" ? "application/json" : "text/plain;charset=utf-8",
    warnings: [...conversion.warnings, ...formatWarnings(request.format, result.warnings)],
  };
}
