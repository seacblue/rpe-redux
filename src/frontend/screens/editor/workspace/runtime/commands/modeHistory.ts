/**
 * Coalesces editor view changes into complete snapshots so preview toggles can
 * restore one intentional layout instead of replaying intermediate switches.
 */

/** The three region switches at one point in time. */
export type EditorModeSnapshot = Readonly<{
  showNotes: boolean;
  showEvents: boolean;
  showPreview: boolean;
}>;

/** The two snapshots exchanged by the preview-only shortcut. */
export interface EditorModeHistory {
  /** Adds the latest view state to the current coalesced transaction. */
  observe(snapshot: EditorModeSnapshot, now: number): void;
  /** Commits the current coalesced transaction, if one is open. */
  flush(): void;
  /** Exchanges the current and previous committed snapshots. */
  swap(): EditorModeSnapshot | null;
}

const sameSnapshot = (left: EditorModeSnapshot, right: EditorModeSnapshot): boolean =>
  left.showNotes === right.showNotes &&
  left.showEvents === right.showEvents &&
  left.showPreview === right.showPreview;

const copySnapshot = (snapshot: EditorModeSnapshot): EditorModeSnapshot => ({ ...snapshot });

/**
 * Creates a two-snapshot history with a fixed transaction window.
 *
 * A sequence starts when the first different snapshot is observed. Changes
 * through the window update only the transaction's final state. The first
 * state is committed as `previous` when the sequence is flushed, so no
 * intermediate layout can become the return target. `initialPrevious` is the
 * optional snapshot used before the first ordinary change, such as the
 * canonical preview layout for the first Ctrl+Space press.
 */
export function createEditorModeHistory(
  initial: EditorModeSnapshot,
  initialPrevious: EditorModeSnapshot | null = null,
  transactionWindowMs = 500,
): EditorModeHistory {
  let current = copySnapshot(initial);
  let previous = initialPrevious === null ? null : copySnapshot(initialPrevious);
  let transactionBefore: EditorModeSnapshot | null = null;
  let transactionStartedAt: number | null = null;

  const flush = (): void => {
    if (transactionBefore === null) {
      return;
    }
    previous = transactionBefore;
    transactionBefore = null;
    transactionStartedAt = null;
  };

  return Object.freeze({
    observe(snapshot: EditorModeSnapshot, now: number): void {
      const next = copySnapshot(snapshot);
      if (sameSnapshot(current, next)) {
        return;
      }
      if (
        transactionBefore === null ||
        transactionStartedAt === null ||
        now - transactionStartedAt > transactionWindowMs
      ) {
        flush();
        transactionBefore = copySnapshot(current);
        transactionStartedAt = now;
      }
      current = next;
    },
    flush,
    swap(): EditorModeSnapshot | null {
      flush();
      if (previous === null) {
        return null;
      }
      const next = previous;
      previous = current;
      current = next;
      return copySnapshot(current);
    },
  });
}
