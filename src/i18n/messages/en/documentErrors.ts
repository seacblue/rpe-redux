/**
 * English explanations and recovery steps for document-host failures.
 * Operation-specific error codes stay separate from the broader workspace copy.
 */
export default {
  "workspace.document.error.openGeneric": "The chart file could not be read.",
  "workspace.document.solution.openGeneric":
    "Confirm that the file exists, is accessible, and uses a supported format; if it still fails, keep the error code and original file for diagnosis.",
  "workspace.document.solution.saveGeneric":
    "Confirm that the destination is writable and not in use by another program, then try saving again; if it still fails, keep the error code.",
  "workspace.document.error.chartTooLarge":
    "The chart JSON is larger than 512 MiB and cannot be processed safely.",
  "workspace.document.solution.chartTooLarge":
    "Compact the JSON first; if it is still too large, reduce or split the chart and try again.",
  "workspace.document.error.pezEntryLimit": "The PEZ package contains more files than allowed.",
  "workspace.document.solution.pezEntryLimit":
    "Remove unused files, or export a PEZ containing only the current chart and its resources.",
  "workspace.document.error.pezSizeOverflow": "The PEZ extracted-size calculation overflowed.",
  "workspace.document.solution.pezSizeOverflow":
    "Export or download the PEZ again; if it still fails, check whether the archive is damaged.",
  "workspace.document.error.pezExtractedSizeLimit":
    "The PEZ package expands beyond the 1 GiB resource limit.",
  "workspace.document.solution.pezExtractedSizeLimit":
    "Remove unused audio, images, or other resources, then export the PEZ again.",
  "workspace.document.error.pezInfoSizeLimit": "A PEZ information file is larger than 8 MiB.",
  "workspace.document.solution.pezInfoSizeLimit":
    "Export the PEZ again and avoid putting large unrelated content in its information file.",
  "workspace.document.error.pezSidecarSizeOverflow":
    "The PEZ information-file size calculation overflowed.",
  "workspace.document.solution.pezSidecarSizeOverflow":
    "Export or download the PEZ again; if it still fails, check whether the archive is damaged.",
  "workspace.document.error.pezEntrySizeMismatch":
    "A PEZ entry size does not match its content; the archive may be damaged.",
  "workspace.document.solution.pezEntrySizeMismatch":
    "Export or download the PEZ again instead of continuing with the damaged archive.",
  "workspace.document.error.pezChartCandidatesLimit":
    "The PEZ contains more chart JSON candidates than allowed.",
  "workspace.document.solution.pezChartCandidatesLimit":
    "Remove unused charts or autosaves and keep only the chart you want to open.",
  "workspace.document.error.pezChartMissing":
    "The PEZ package does not contain an openable RPE chart.",
  "workspace.document.solution.pezChartMissing":
    "Confirm that the package contains valid chart JSON and that info.txt names the correct Chart path.",
  "workspace.document.error.pezMultipleCharts":
    "The PEZ contains multiple charts, so the chart to open is ambiguous.",
  "workspace.document.solution.pezMultipleCharts":
    "Set one Chart path in info.txt, or remove the charts you do not need.",
  "workspace.document.error.unsafeResourcePath": "The PEZ contains an unsafe resource path.",
  "workspace.document.solution.unsafeResourcePath":
    "Put resources inside the chart folder and export the PEZ again with normalized relative paths.",
  "workspace.document.error.invalidChartData":
    "The chart data is invalid and cannot be parsed or saved.",
  "workspace.document.solution.invalidChartData":
    "Check the JSON syntax and chart fields; restore the most recent usable backup if needed.",
  "workspace.document.error.chartPackageIdMissing":
    "The chart is missing the project identifier required for packaging.",
  "workspace.document.solution.chartPackageIdMissing":
    "Save the chart as a project first, then run the export or packaging action again.",
  "workspace.document.error.invalidChunkData":
    "An invalid chart-data chunk was received while saving.",
  "workspace.document.solution.invalidChunkData":
    "Cancel the current save and try again; if it persists, reopen the chart before saving.",
  "workspace.document.error.resourceSizeMismatch":
    "A chart resource size does not match the save record.",
  "workspace.document.solution.resourceSizeMismatch":
    "Re-import or replace the affected resource, then save again.",
  "workspace.document.solution.saveBaselineUnavailable":
    "Confirm that the original file still exists and is readable; use Save As to choose a new location if needed.",
  "workspace.document.solution.saveSessionMissing":
    "Run Save again; if it persists, reopen the chart first.",
  "workspace.document.solution.saveAssetsBinaryRequired":
    "Run Save again so the application can send resources as binary data.",
  "workspace.document.solution.invalidSaveAssetData":
    "Re-import the affected resource, then save again.",
  "workspace.document.solution.saveAssetMissing":
    "Re-import the missing resource, then save again.",
  "workspace.document.solution.duplicateSaveAsset":
    "Remove the duplicate resource entry, then save again.",
  "workspace.document.solution.saveDestinationExists":
    "Choose an empty export location or confirm the replacement, then export again.",
  "workspace.document.solution.saveAssetFilenameMissing":
    "Give the resource a file name, then save again.",
  "workspace.document.solution.saveExportDirectoryRequired":
    "Choose a valid export directory and try again.",
  "workspace.document.solution.unsafeSaveAssetPath":
    "Copy external resources into the chart folder, then save or export the PEZ again.",
  "workspace.document.solution.saveFailed":
    "Check the destination, resources, and available disk space, then try again; if it persists, keep the error code.",
  "workspace.document.solution.libraryRevisionConflict":
    "Reload the latest library version, review your changes, and save again.",
  "workspace.document.solution.saveConflict":
    "Choose whether to keep the local edits; use Save As if you need a separate copy.",
  "workspace.document.solutionLabel": "Solution",
} as const;
