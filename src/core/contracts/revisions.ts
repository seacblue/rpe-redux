/**
 * The document revision snapshot shared by the document coordinator, the Code Cell
 * adapter, and the code-cell runtime.
 *
 * Every surface pins the same fields before a read or write; keeping the shape
 * and conflict rule here prevents a second, subtly different definition of
 * "stale". Editor coordination state extends the base snapshot with the last
 * saved chart fingerprint so dirty tracking can compare the live chart with the
 * last saved chart; Code Cell snapshots stay on the three pin fields.
 */
export interface DocumentRevisions {
  readonly chartFingerprint: string | null;
  readonly diskSnapshot: string | null;
  readonly generation: number;
}

/** Editor coordination state: the pin fields plus the last saved chart. */
export interface CoordinatedRevisions extends DocumentRevisions {
  readonly savedChartFingerprint: string | null;
}

/** Revision fields a caller may pin before a read or write. */
export type RevisionPinField = "chartFingerprint" | "diskSnapshot" | "generation";

/**
 * Narrows any revision snapshot to the fields every surface pins.
 *
 * Use this when an editor coordination snapshot crosses into a Code Cell or a code
 * cell, so the saved-state-only field never leaks into a public result.
 */
export function toDocumentRevisions(revisions: DocumentRevisions): DocumentRevisions {
  return {
    chartFingerprint: revisions.chartFingerprint,
    diskSnapshot: revisions.diskSnapshot,
    generation: revisions.generation,
  };
}

/** Fields whose explicit pin no longer matches the current snapshot. */
export function revisionConflicts(
  expected: Partial<Pick<DocumentRevisions, RevisionPinField>> | undefined,
  current: DocumentRevisions,
): readonly RevisionPinField[] {
  if (!expected) {
    return [];
  }
  const conflicts: RevisionPinField[] = [];
  for (const key of ["chartFingerprint", "diskSnapshot", "generation"] as const) {
    if (expected[key] !== undefined && expected[key] !== current[key]) {
      conflicts.push(key);
    }
  }
  return conflicts;
}
