/**
 * Snapshot completeness guards.
 *
 * A backup is only worth keeping if it is the whole chart. A paged document exposes
 * placeholder lines for content it has not paged in, and those placeholders have
 * empty note and event arrays: writing one would store a chart with that content
 * deleted, and restoring it would destroy the user's work.
 *
 * `assertSnapshotComplete` is the last line of defence at the write boundary. It
 * fails loudly instead of writing a partial snapshot, so a bug upstream becomes a
 * visible backup error rather than silent data loss.
 */
import { isPlaceholderLine } from "../../../../../../core/global/chart/streaming/chartDocument.ts";

/** Error raised when a snapshot would drop chart content. */
export class IncompleteSnapshotError extends Error {
  /** How many lines were still placeholders. */
  readonly placeholderLines: number;

  /** Build the error with the count that made the snapshot unsafe. */
  constructor(placeholderLines: number) {
    super(
      `refusing to write an incomplete chart snapshot (${placeholderLines} unmaterialized lines)`,
    );
    this.name = "IncompleteSnapshotError";
    this.placeholderLines = placeholderLines;
  }
}

/** Raised when there is no chart value to snapshot at all. */
export class MissingSnapshotChartError extends Error {
  /** Build the error for an absent chart. */
  constructor() {
    super("refusing to write a chart snapshot without a chart");
    this.name = "MissingSnapshotChartError";
  }
}

/**
 * Throw when a chart still contains placeholder lines.
 *
 * Call this immediately before serializing a backup. A chart that has loaded every
 * line, which is what the editor always holds, passes without work beyond a scan of
 * the line list. A missing chart is a separate failure: it means the caller lost the
 * document, not that the document was partial, and the two must not share a message.
 */
export function assertSnapshotComplete(chart: unknown): void {
  if (!chart || typeof chart !== "object") {
    throw new MissingSnapshotChartError();
  }
  const lines = (chart as { judgeLineList?: unknown }).judgeLineList;
  if (!Array.isArray(lines)) {
    return;
  }
  let placeholders = 0;
  for (const line of lines) {
    if (isPlaceholderLine(line)) {
      placeholders += 1;
    }
  }
  if (placeholders > 0) {
    throw new IncompleteSnapshotError(placeholders);
  }
}
