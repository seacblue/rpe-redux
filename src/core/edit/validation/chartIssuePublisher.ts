/**
 * Publishes the newest chart issue scan to the inspector.
 *
 * The scan runs elsewhere — a worker, or the synchronous fallback — so this
 * module only owns three things: which chart revision a published snapshot
 * belongs to, collapsing a burst of edit notifications into one scan of the
 * newest chart, and publishing only when the visible issue list changed.
 *
 * Consumers read `state`; nothing here decides presentation. Each issue carries
 * its kind, and `chartIssueTypes.ts` owns the label, severity, and filter text.
 */
import { createValue, type ValueCell } from "../../state/values.ts";
import type { Chart } from "../../global/chart/chart.ts";
import {
  CHART_ISSUE_KINDS,
  EMPTY_CHART_ISSUE_SNAPSHOT,
  type ChartIssue,
  type ChartIssueSnapshot,
} from "./chartIssueTypes.ts";
import type {
  ChartIssueScanInput,
  ChartIssueScanOptions,
  ChartIssueScanResult,
} from "./chartIssueScan.ts";

/** Live issue count used by the inspector sidebar's badge. */
export const chartIssueCount = createValue({ initial: 0 });

/**
 * The badge colour: red when something breaks playback, yellow when the list
 * holds only cautions such as a density hint.
 */
export const chartIssueBadgeTone = createValue<"error" | "warning">({ initial: "error" });

/** Run one scan away from the caller's thread. */
export type ChartIssueScanner = (input: ChartIssueScanInput) => Promise<ChartIssueScanResult>;

/**
 * Stable identity for one set of scan options.
 *
 * A threshold change must rescan even though the chart object is unchanged, so
 * the publisher compares this string as well as the chart reference.
 */
function scanOptionsKey(options: ChartIssueScanOptions): string {
  const checks = CHART_ISSUE_KINDS.map((kind) => (options.checks[kind] === false ? 0 : 1)).join("");
  const density = options.densityOptions;
  return [
    checks,
    density.caution,
    density.radius,
    density.bucketSeconds,
    density.holdWeight,
    density.includeFake ? 1 : 0,
    density.maxLookbackSeconds,
    density.maxIssues,
  ].join("|");
}

/** Whether two published issues describe the same row. */
function sameIssue(left: ChartIssue, right: ChartIssue): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.severity === right.severity &&
    left.target === right.target &&
    left.lineIndex === right.lineIndex &&
    left.lineName === right.lineName &&
    left.layer === right.layer &&
    left.extended === right.extended &&
    left.track === right.track &&
    left.firstEventIndex === right.firstEventIndex &&
    left.secondEventIndex === right.secondEventIndex &&
    left.beat === right.beat &&
    left.endBeat === right.endBeat &&
    left.peak === right.peak &&
    left.resourceName === right.resourceName &&
    left.resourceKind === right.resourceKind
  );
}

/** Compare the visible issue lists without allocating a signature string. */
function sameIssues(left: readonly ChartIssue[], right: readonly ChartIssue[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!sameIssue(left[index], right[index])) {
      return false;
    }
  }
  return true;
}

/** Merge scans over time and publish the newest one. */
export class EventIssueMonitor {
  /** Published snapshot; read-only to consumers. */
  readonly state: ValueCell<ChartIssueSnapshot> = createValue({
    initial: EMPTY_CHART_ISSUE_SNAPSHOT,
  });

  private revision = 0;
  /** The chart the newest request named; a repeated request is a no-op. */
  private requestedChart: Chart | null = null;
  /** The scan options that chart was requested with, so a threshold change rescans. */
  private requestedOptions = "";
  /** The newest request the scanner has not started yet. */
  private queued: ChartIssueScanInput | null = null;
  private running = false;
  private readonly scanner: ChartIssueScanner;
  private scannedIssues: readonly ChartIssue[] = [];
  private scannedPeak = 0;
  private externalIssues: readonly ChartIssue[] = [];

  constructor(scanner: ChartIssueScanner) {
    this.scanner = scanner;
  }

  /**
   * Request a scan of `input.chart` with `input.options`.
   *
   * Returns immediately. A request that arrives while a scan is running replaces
   * the queued input, so a burst of edits costs one scan of the newest chart.
   * A request repeating both the chart and its options is free; changing only a
   * threshold still rescans, because the published count depends on it.
   */
  request(input: ChartIssueScanInput): void {
    const chart = input.chart;
    const options = scanOptionsKey(input.options);
    if (
      chart === this.requestedChart &&
      options === this.requestedOptions &&
      !this.queued &&
      !this.running
    ) {
      return;
    }
    this.requestedChart = chart;
    this.requestedOptions = options;
    this.queued = input;
    if (!this.running) {
      void this.drain();
    }
  }

  /** Scan until the queue is empty, always working from the newest request. */
  private async drain(): Promise<void> {
    this.running = true;
    this.state.update({ status: "scanning" });
    try {
      while (this.queued) {
        const input = this.queued;
        this.queued = null;
        let result: ChartIssueScanResult;
        try {
          result = await this.scanner(input);
        } catch {
          this.state.update({ status: "failed" });
          continue;
        }
        this.publish(result.issues, result.densityPeak);
      }
      this.state.update({ status: "ready" });
    } finally {
      this.running = false;
    }
  }

  /** Drop every published issue, e.g. after the check is switched off. */
  clear(): void {
    this.queued = null;
    this.requestedChart = null;
    this.requestedOptions = "";
    this.scannedIssues = [];
    this.scannedPeak = 0;
    this.externalIssues = [];
    chartIssueCount.set(0);
    chartIssueBadgeTone.set("error");
    if (this.state.get() === EMPTY_CHART_ISSUE_SNAPSHOT) {
      return;
    }
    this.revision += 1;
    this.state.set(EMPTY_CHART_ISSUE_SNAPSHOT);
  }

  /** Replace issues supplied by a media/resource loader and republish the list. */
  setExternalIssues(issues: readonly ChartIssue[]): void {
    this.externalIssues = issues;
    this.publish(this.scannedIssues, this.scannedPeak);
  }

  /** Merge one completed scan into the published snapshot. */
  private publish(issues: readonly ChartIssue[], peak: number): void {
    this.scannedIssues = issues;
    this.scannedPeak = peak;
    const merged = [...issues, ...this.externalIssues];
    const previous = this.state.get();
    // The rail badge counts every published issue, warnings included: a density
    // hint is still something the chart author has to look at. Its colour is
    // decided by the list's strongest severity, so a caution never reads as a
    // broken chart.
    chartIssueCount.set(merged.length);
    chartIssueBadgeTone.set(
      merged.some((issue) => issue.severity === "error" || issue.severity === "fatal")
        ? "error"
        : "warning",
    );
    // The peak is read by the HUD on its own, so an unchanged list still has to
    // publish a changed peak.
    if (previous.peak === peak && sameIssues(previous.issues, merged)) {
      return;
    }
    this.revision += 1;
    this.state.set({
      revision: this.revision,
      issues: Object.freeze(merged),
      status: previous.status,
      peak,
    });
  }
}
