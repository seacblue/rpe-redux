/** Home-library keyboard navigation and frame coalescing. */

/** The live list and selection target used by the Q/E navigation commands. */
export interface LibraryNavigationState {
  entries: readonly { key: string }[];
  selectedKey: string | null;
  select(key: string, preview: boolean): void;
}

/** A scheduler that submits at most one keyboard selection per animation frame. */
export interface LibraryNavigationScheduler {
  move(direction: -1 | 1): void;
  /** Accept a selection made outside the scheduler and reset its cursor. */
  sync(selectedKey: string | null): void;
  dispose(): void;
}

/** Return the next visible entry in the requested direction, or null at an edge. */
export function nextLibraryNavigationKey(
  entries: readonly { key: string }[],
  selectedKey: string | null,
  direction: -1 | 1,
): string | null {
  if (!entries.length) {
    return null;
  }
  const current = entries.findIndex((entry) => entry.key === selectedKey);
  const next =
    current < 0
      ? direction > 0
        ? 0
        : entries.length - 1
      : Math.min(entries.length - 1, Math.max(0, current + direction));
  return next === current ? null : entries[next].key;
}

/**
 * Coalesce OS key-repeat bursts before they update React state.
 *
 * The pending key advances from the previous pending key, so a burst still
 * moves the requested number of positions while React receives one update.
 */
export function createLibraryNavigationScheduler(
  read: () => LibraryNavigationState,
  requestFrame: (callback: () => void) => number,
  cancelFrame: (frame: number) => void,
): LibraryNavigationScheduler {
  let frame: number | null = null;
  let pendingKey: string | null = null;
  let cursorKey: string | null = null;

  const flush = () => {
    frame = null;
    const key = pendingKey;
    pendingKey = null;
    if (key === null) {
      return;
    }
    const state = read();
    if (state.entries.some((entry) => entry.key === key) && key !== state.selectedKey) {
      state.select(key, true);
    }
  };

  return {
    move(direction) {
      const state = read();
      if (cursorKey === null) {
        cursorKey = state.selectedKey;
      }
      const key = nextLibraryNavigationKey(state.entries, pendingKey ?? cursorKey, direction);
      if (key === null) {
        return;
      }
      pendingKey = key;
      cursorKey = key;
      if (frame === null) {
        frame = requestFrame(flush);
      }
    },
    sync(selectedKey) {
      if (frame !== null) {
        cancelFrame(frame);
        frame = null;
      }
      pendingKey = null;
      cursorKey = selectedKey;
    },
    dispose() {
      if (frame !== null) {
        cancelFrame(frame);
        frame = null;
      }
      pendingKey = null;
      cursorKey = null;
    },
  };
}
