/** Prepares one editor candidate, including the current-format conversion gate. */
import { BUILD_APP_VERSION } from "../../../../../../core/platform/buildInfo.ts";
import {
  convertChartToCurrentVersion,
  detectChartCompatibility,
} from "../../../../../../core/global/chart/compatibility.ts";
import { CURRENT_RPE_VERSION } from "../../../../../../core/global/chart/chart.ts";
import type { LoadTask } from "../../../../../../core/global/document/loading.ts";
import type { EditorCandidate } from "../../../../../../core/global/document/types.ts";
import { t } from "../../../../../../i18n/index.ts";
import type { PreparedEditorCandidate } from "./queuedCandidateLoader.ts";

/** Minimal confirmation surface needed by candidate preparation. */
export type CandidateConfirm = (options: {
  title: string;
  description: string;
  detail?: string;
  label: string;
  cancelLabel: string;
}) => Promise<boolean>;

/** Validate a candidate and offer conversion when its chart format is older. */
export async function prepareEditorCandidate(
  candidate: EditorCandidate,
  requestConfirm: CandidateConfirm,
  task?: LoadTask,
): Promise<PreparedEditorCandidate | null> {
  const report = detectChartCompatibility(candidate.chart);
  if (!report.requiresConversion) {
    if (report.reduxVersionStatus !== "newer") {
      return candidate;
    }
    const confirmed = await requestConfirm({
      title: t("workspace.document.compatibility.newerTitle"),
      description: t("workspace.document.compatibility.newerDescription", {
        version: report.reduxVersion ?? "",
        current: BUILD_APP_VERSION,
      }),
      label: t("workspace.document.compatibility.openAnyway"),
      cancelLabel: t("workspace.document.compatibility.cancel"),
    });
    return confirmed ? candidate : null;
  }
  const confirmed = await requestConfirm({
    title: t("workspace.document.compatibility.title"),
    description:
      report.rpeVersion === null
        ? t("workspace.document.compatibility.descriptionUnknown")
        : t("workspace.document.compatibility.description", { version: report.rpeVersion }),
    detail: report.missingLineFields
      ? t("workspace.document.compatibility.detail", {
          version: CURRENT_RPE_VERSION,
          count: report.missingLineFields,
        })
      : undefined,
    label: t("workspace.document.compatibility.convert"),
    cancelLabel: t("workspace.document.compatibility.cancel"),
  });
  if (!confirmed) {
    return null;
  }
  // A streamed candidate's facade contains placeholders and still owns the
  // old header. Conversion must operate on the complete chart, then the
  // session must use that plain snapshot instead of reinstalling the facade.
  const source = candidate.chartDocument
    ? await candidate.chartDocument.materializeAll({
        onProgress: ({ completedLines, totalLines }) =>
          task?.update("parse", completedLines, totalLines),
      })
    : candidate.chart;
  const conversionReport = candidate.chartDocument ? detectChartCompatibility(source) : report;
  const conversion = convertChartToCurrentVersion(source, conversionReport, (completed, total) =>
    task?.update("parse", completed, total),
  );
  if (!conversion) {
    return null;
  }
  if (!candidate.chartDocument) {
    return {
      ...candidate,
      chart: conversion.chart,
      revisionSeed: undefined,
      converted: conversion.converted,
    };
  }
  candidate.disposeDocument?.();
  const {
    chartDocument: _chartDocument,
    disposeDocument: _disposeDocument,
    ...plainCandidate
  } = candidate;
  return {
    ...plainCandidate,
    chart: conversion.chart,
    revisionSeed: undefined,
    converted: conversion.converted,
  };
}
