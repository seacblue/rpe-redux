/**
 * Chart backups on the library's branch tree.
 *
 * A library project keeps one automatic snapshot for every autosave tick and one
 * before each restore, so a restore can always be undone by restoring the node it
 * recorded. This module is the single caller of the snapshot endpoints: the frame
 * autosave appends nodes, and the restore dialog lists and applies them.
 *
 * A native file has no project, so it has no tree; its recovery draft is still
 * written by the document store.
 */
import { serializeChartStream } from "./chartSerializeOffThread.ts";
import { assertSnapshotComplete } from "./snapshotIntegrity.ts";
import { registeredChartDocument } from "../../../../../../core/global/chart/streaming/chartDocumentRegistry.ts";
import { localService } from "../../../../../../core/global/library/service.ts";
import type {
  LibrarySnapshotReason,
  LibrarySnapshotSummary,
} from "../../../../../../core/global/library/client.ts";
import type { Chart } from "../../../../../../core/global/chart/chart.ts";

/** The library this module reads and writes. */
async function requireLibrary() {
  const found = await localService();
  if (!found) {
    throw new Error("the library service is unavailable");
  }
  return found.library;
}

/**
 * Resolve a chart to a complete snapshot source.
 *
 * A library document is opened through its paged facade, which exposes placeholder
 * lines for content it has not paged in. Serializing the facade directly can work,
 * but the completeness guard below inspects the object graph, so materialize first:
 * a backup must succeed and must contain every line. A plain chart has no document
 * and is already whole.
 */
async function completeChart(chart: Chart): Promise<Chart> {
  const document =
    chart && typeof chart === "object" ? registeredChartDocument(chart as object) : undefined;
  return document ? document.materializeAll() : chart;
}

/**
 * Append one snapshot node for a library project.
 *
 * The chart is completed, checked for unmaterialized lines, and then serialized in
 * bounded chunks through the same stream the save path uses. Autosave runs inside
 * the frame loop, so the write must not build one flat string on the main thread:
 * appending chunks keeps the text in V8's rope representation, while `join` or a
 * Blob copy flattens it in a single uninterruptible task (56 ms flat versus 1 ms
 * appended on an 8000-line chart). A chart that still holds placeholder lines is
 * refused rather than stored, because a partial backup would restore as data loss.
 *
 * Returns null when there is no project to back up.
 */
export async function appendSnapshot(
  projectId: string | null,
  chart: Chart,
  reason: LibrarySnapshotReason,
  editSeconds = 0,
): Promise<LibrarySnapshotSummary | null> {
  if (!projectId) {
    return null;
  }
  const complete = await completeChart(chart);
  assertSnapshotComplete(complete);
  const library = await requireLibrary();
  let chartJson = "";
  for await (const chunk of serializeChartStream(complete)) {
    chartJson += chunk;
  }
  const result = await library.createSnapshot(projectId, {
    chartJson,
    reason,
    advanceHead: true,
    editSeconds: Math.max(0, Math.floor(editSeconds)),
  });
  return result.snapshot;
}

/** Append the automatic backup the frame autosave takes. */
export function appendAutomaticSnapshot(
  projectId: string | null,
  chart: Chart,
  editSeconds = 0,
): Promise<LibrarySnapshotSummary | null> {
  return appendSnapshot(projectId, chart, "auto", editSeconds);
}

/** List a project's snapshots, newest first. */
export async function listSnapshots(
  projectId: string,
  limit = 100,
): Promise<LibrarySnapshotSummary[]> {
  const library = await requireLibrary();
  const history = await library.snapshots(projectId, { limit });
  return history.snapshots;
}

/**
 * Apply one snapshot to its project.
 *
 * The service records the chart it replaces as a `restore` node and moves the
 * head onto the restored node, so the replaced chart stays reachable and the next
 * automatic backup continues from the restored branch.
 */
export async function restoreSnapshot(snapshotId: string): Promise<LibrarySnapshotSummary> {
  const library = await requireLibrary();
  const result = await library.restoreSnapshot(snapshotId);
  return result.snapshot;
}
