/**
 * Maps document-host failures to user-facing explanations and recovery steps.
 * Stable native codes stay available for diagnostics without becoming the
 * primary message shown in the workspace.
 */
import { tRaw } from "../../../i18n/index.ts";

/** An error enriched with a localized explanation and an actionable solution. */
export interface DocumentError extends Error {
  /** Stable native or host code, when one exists. */
  code?: string;
  /** The next action a person can take to recover from the failure. */
  solution: string;
  /** Marks an error that has already been normalized by this module. */
  documentError: true;
}

type Copy = { messageKey: string; solutionKey: string };

const OPEN_COPIES: Record<string, Copy> = {
  pez_entry_limit: {
    messageKey: "workspace.document.error.pezEntryLimit",
    solutionKey: "workspace.document.solution.pezEntryLimit",
  },
  pez_size_overflow: {
    messageKey: "workspace.document.error.pezSizeOverflow",
    solutionKey: "workspace.document.solution.pezSizeOverflow",
  },
  pez_extracted_size_limit: {
    messageKey: "workspace.document.error.pezExtractedSizeLimit",
    solutionKey: "workspace.document.solution.pezExtractedSizeLimit",
  },
  pez_chart_size_limit: {
    messageKey: "workspace.document.error.chartTooLarge",
    solutionKey: "workspace.document.solution.chartTooLarge",
  },
  pez_info_size_limit: {
    messageKey: "workspace.document.error.pezInfoSizeLimit",
    solutionKey: "workspace.document.solution.pezInfoSizeLimit",
  },
  pez_sidecar_size_overflow: {
    messageKey: "workspace.document.error.pezSidecarSizeOverflow",
    solutionKey: "workspace.document.solution.pezSidecarSizeOverflow",
  },
  pez_entry_size_mismatch: {
    messageKey: "workspace.document.error.pezEntrySizeMismatch",
    solutionKey: "workspace.document.solution.pezEntrySizeMismatch",
  },
  pez_chart_candidates_limit: {
    messageKey: "workspace.document.error.pezChartCandidatesLimit",
    solutionKey: "workspace.document.solution.pezChartCandidatesLimit",
  },
  pez_chart_missing: {
    messageKey: "workspace.document.error.pezChartMissing",
    solutionKey: "workspace.document.solution.pezChartMissing",
  },
  pez_multiple_charts: {
    messageKey: "workspace.document.error.pezMultipleCharts",
    solutionKey: "workspace.document.solution.pezMultipleCharts",
  },
  unsafe_resource_path: {
    messageKey: "workspace.document.error.unsafeResourcePath",
    solutionKey: "workspace.document.solution.unsafeResourcePath",
  },
  chart_too_large: {
    messageKey: "workspace.document.error.chartTooLarge",
    solutionKey: "workspace.document.solution.chartTooLarge",
  },
  invalid_save_chart: {
    messageKey: "workspace.document.error.invalidChartData",
    solutionKey: "workspace.document.solution.invalidChartData",
  },
};

const SAVE_COPIES: Record<string, Copy> = {
  save_baseline_unavailable: {
    messageKey: "workspace.document.error.saveBaselineUnavailable",
    solutionKey: "workspace.document.solution.saveBaselineUnavailable",
  },
  save_session_missing: {
    messageKey: "workspace.document.error.saveSessionMissing",
    solutionKey: "workspace.document.solution.saveSessionMissing",
  },
  save_assets_binary_required: {
    messageKey: "workspace.document.error.saveAssetsBinaryRequired",
    solutionKey: "workspace.document.solution.saveAssetsBinaryRequired",
  },
  invalid_save_asset_data: {
    messageKey: "workspace.document.error.invalidSaveAssetData",
    solutionKey: "workspace.document.solution.invalidSaveAssetData",
  },
  incomplete_save_asset_data: {
    messageKey: "workspace.document.error.invalidSaveAssetData",
    solutionKey: "workspace.document.solution.invalidSaveAssetData",
  },
  pez_to_json_export_directory_required: {
    messageKey: "workspace.document.error.saveExportDirectoryRequired",
    solutionKey: "workspace.document.solution.saveExportDirectoryRequired",
  },
  embedded_assets_export_directory_required: {
    messageKey: "workspace.document.error.saveExportDirectoryRequired",
    solutionKey: "workspace.document.solution.saveExportDirectoryRequired",
  },
  asset_export_directory_missing: {
    messageKey: "workspace.document.error.saveExportDirectoryRequired",
    solutionKey: "workspace.document.solution.saveExportDirectoryRequired",
  },
  unsafe_save_asset_path: {
    messageKey: "workspace.document.error.unsafeSaveAssetPath",
    solutionKey: "workspace.document.solution.unsafeSaveAssetPath",
  },
  save_asset_missing: {
    messageKey: "workspace.document.error.saveAssetMissing",
    solutionKey: "workspace.document.solution.saveAssetMissing",
  },
  duplicate_save_asset: {
    messageKey: "workspace.document.error.duplicateSaveAsset",
    solutionKey: "workspace.document.solution.duplicateSaveAsset",
  },
  asset_export_destination_exists: {
    messageKey: "workspace.document.error.saveDestinationExists",
    solutionKey: "workspace.document.solution.saveDestinationExists",
  },
  save_asset_filename_missing: {
    messageKey: "workspace.document.error.saveAssetFilenameMissing",
    solutionKey: "workspace.document.solution.saveAssetFilenameMissing",
  },
  chart_too_large: {
    messageKey: "workspace.document.error.chartTooLarge",
    solutionKey: "workspace.document.solution.chartTooLarge",
  },
  invalid_save_chart: {
    messageKey: "workspace.document.error.invalidChartData",
    solutionKey: "workspace.document.solution.invalidChartData",
  },
  chart_package_id_missing: {
    messageKey: "workspace.document.error.chartPackageIdMissing",
    solutionKey: "workspace.document.solution.chartPackageIdMissing",
  },
  invalid_chunk_data: {
    messageKey: "workspace.document.error.invalidChunkData",
    solutionKey: "workspace.document.solution.invalidChunkData",
  },
  resource_size_mismatch: {
    messageKey: "workspace.document.error.resourceSizeMismatch",
    solutionKey: "workspace.document.solution.resourceSizeMismatch",
  },
  save_outcome_serialize_failed: {
    messageKey: "workspace.document.error.saveFailed",
    solutionKey: "workspace.document.solution.saveFailed",
  },
};

/** Read a stable code from a native error without treating ordinary text as one. */
function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split(/\r?\n/, 1)[0].trim();
  return /^[a-z][a-z0-9_.:-]*$/.test(firstLine) ? firstLine : undefined;
}

/** Convert native wording into a stable code where the host uses prose errors. */
function inferredCode(message: string, code: string | undefined): string | undefined {
  if (code) {
    return code;
  }
  if (message.startsWith("No RPE chart found in the PEZ archive.")) {
    return "pez_chart_missing";
  }
  if (message.startsWith("PEZ contains multiple charts.")) {
    return "pez_multiple_charts";
  }
  if (message === "Unsafe PEZ resource path.") {
    return "unsafe_resource_path";
  }
  return undefined;
}

/** Resolve prefix-bearing save codes without discarding their diagnostic suffix. */
function copyFor(operation: "open" | "save", code: string | undefined): Copy | undefined {
  if (!code) {
    return undefined;
  }
  const copies = operation === "open" ? OPEN_COPIES : SAVE_COPIES;
  if (copies[code]) {
    return copies[code];
  }
  if (operation !== "save") {
    return undefined;
  }
  if (code.startsWith("save_asset_missing:")) {
    return SAVE_COPIES.save_asset_missing;
  }
  if (code.startsWith("duplicate_save_asset:")) {
    return SAVE_COPIES.duplicate_save_asset;
  }
  if (code.startsWith("asset_export_destination_exists:")) {
    return SAVE_COPIES.asset_export_destination_exists;
  }
  if (code.startsWith("save_asset_filename_missing:")) {
    return SAVE_COPIES.save_asset_filename_missing;
  }
  return undefined;
}

/** Build one localized document error while retaining the original diagnostic as its cause. */
export function localizeDocumentError(error: unknown, operation: "open" | "save"): DocumentError {
  if (
    error &&
    typeof error === "object" &&
    "documentError" in error &&
    error.documentError === true
  ) {
    return error as DocumentError;
  }
  const source = error instanceof Error ? error : new Error(String(error));
  const code = inferredCode(source.message, errorCode(error));
  const copy = copyFor(operation, code);
  const message = copy ? tRaw(copy.messageKey) : source.message;
  const solution = copy
    ? tRaw(copy.solutionKey)
    : tRaw(
        operation === "open"
          ? "workspace.document.solution.openGeneric"
          : "workspace.document.solution.saveGeneric",
      );
  const localized = Object.assign(new Error(message, { cause: error }), {
    code,
    solution,
    documentError: true as const,
  });
  localized.name = source.name;
  return localized;
}
