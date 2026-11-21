/**
 * Message shapes shared by the chart issue worker and its main-thread caller.
 *
 * A chart with a hundred thousand notes cannot cross one `postMessage` without
 * the structured clone blocking the UI thread, so the caller sends the header
 * once and then one judge line per message. The worker keeps the previous
 * scan's lines and the caller re-sends only the lines whose object identity
 * changed, which is exactly the set a copy-on-write edit touched.
 */
import type { Chart } from "../../global/chart/chart.ts";
import type { ChartIssueScanOptions, ScannedIssue } from "./chartIssueScan.ts";
import type { ChartIssueKind } from "./chartIssueTypes.ts";
import type { NoteDensityOptions } from "./noteDensityScan.ts";

/** The scan-relevant options, read fresh from the settings page per request. */
export interface ChartIssueWorkerOptions {
  checks: Readonly<Partial<Record<ChartIssueKind, boolean>>>;
  densityOptions: NoteDensityOptions;
}

/** Open one scan: the chart header and the line count to expect. */
export interface ChartIssueWorkerStart {
  type: "start";
  id: number;
  header: Record<string, unknown>;
  lineCount: number;
  options: ChartIssueWorkerOptions;
}

/** One judge line for the open scan. */
export interface ChartIssueWorkerLine {
  type: "line";
  id: number;
  index: number;
  line: unknown;
}

/** Close the open scan and run it. */
export interface ChartIssueWorkerFinish {
  type: "finish";
  id: number;
}

/** Drop one open scan; the caller has a newer request. */
export interface ChartIssueWorkerCancel {
  type: "cancel";
  id: number;
}

/** Any message the caller may post. */
export type ChartIssueWorkerRequest =
  ChartIssueWorkerStart | ChartIssueWorkerLine | ChartIssueWorkerFinish | ChartIssueWorkerCancel;

/** The worker's answer for one scan. */
export interface ChartIssueWorkerReply {
  type: "result";
  id: number;
  issues: ScannedIssue[];
  densityPeak: number;
}

/** Split one scan-input object into the message fields the worker expects. */
export function chartIssueWorkerOptions(options: ChartIssueScanOptions): ChartIssueWorkerOptions {
  return {
    checks: options.checks,
    densityOptions: options.densityOptions,
  };
}

/** Rebuild the scanner input from the worker's accumulated scan state. */
export function chartIssueScanInput(
  header: Record<string, unknown>,
  lines: unknown[],
  options: ChartIssueWorkerOptions,
): { chart: Chart; options: ChartIssueScanOptions } {
  return {
    chart: { ...header, judgeLineList: lines } as Chart,
    options: {
      checks: options.checks,
      densityOptions: options.densityOptions,
    },
  };
}
