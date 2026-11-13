/**
 * Values behind the batch-import progress dialog.
 *
 * The long task reports a 0–1 fraction; the dialog shows a percentage and a
 * completed/total count. Keeping the arithmetic here lets the UI stay a render
 * layer and lets the import limits be tested without a DOM.
 */

/** One render snapshot for the import progress dialog. */
export interface ImportProgressSnapshot {
  /** True while the long task can still report progress. */
  readonly running: boolean;
  /** Whole percentage, or null while the task is indeterminate. */
  readonly percent: number | null;
  /** Completed charts, clamped to the total. */
  readonly done: number;
  /** Accessible readout for the bar, when the task is determinate. */
  readonly valueText: string | undefined;
}

/**
 * Compute the dialog values for one long task report.
 *
 * @param progress The task's 0–1 fraction, or null/undefined when unknown.
 * @param total Selected chart count; values below one render as zero.
 * @param status The long task status; only running/cancelling count as working.
 */
export function importProgressSnapshot(
  progress: number | null | undefined,
  total: number,
  status: string,
): ImportProgressSnapshot {
  const running = status === "running" || status === "cancelling";
  const chartCount = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  if (progress === null || progress === undefined || !Number.isFinite(progress)) {
    return { running, percent: null, done: 0, valueText: undefined };
  }
  const ratio = Math.min(1, Math.max(0, progress));
  const percent = Math.round(ratio * 100);
  return {
    running,
    percent,
    done: Math.min(chartCount, Math.round(ratio * chartCount)),
    valueText: `${percent}%`,
  };
}
