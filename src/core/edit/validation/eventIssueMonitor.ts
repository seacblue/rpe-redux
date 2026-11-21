/**
 * The chart issue boundary: scan, publish, and the shape consumers read.
 *
 * Three modules make up this area and this file is their public seam:
 * `chartIssueScan.ts` walks a chart snapshot, `noteDensityScan.ts` estimates
 * on-screen density, and `chartIssuePublisher.ts` merges results into the
 * snapshot the inspector renders. Keeping the re-export here means a consumer
 * imports one path whether it needs the scanner, the publisher, or the types.
 */
export {
  scanChartIssues,
  type ChartIssueScanInput,
  type ChartIssueScanOptions,
  type ChartIssueScanResult,
  type ScannedIssue,
} from "./chartIssueScan.ts";
export {
  scanNoteDensity,
  DEFAULT_NOTE_DENSITY_OPTIONS,
  type NoteDensityOptions,
  type NoteDensityRange,
  type NoteDensityScan,
} from "./noteDensityScan.ts";
export {
  chartIssueBadgeTone,
  chartIssueCount,
  EventIssueMonitor,
  type ChartIssueScanner,
} from "./chartIssuePublisher.ts";
export {
  CHART_ISSUE_KINDS,
  CHART_ISSUE_KIND_DEFINITIONS,
  chartIssueKindDefinition,
  EMPTY_CHART_ISSUE_SNAPSHOT,
  type ChartIssue,
  type ChartIssueKind,
  type ChartIssueKindDefinition,
  type ChartIssueSeverity,
  type ChartIssueSnapshot,
} from "./chartIssueTypes.ts";
