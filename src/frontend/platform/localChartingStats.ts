/**
 * Persists the author's local charting counters and reconciles them with one
 * editor session. Project metadata is deliberately not part of this ledger.
 */
import type { EditorSession, PlacementStats } from "../../core/edit/session/session.ts";

/** Storage slot for counters owned by this browser installation. */
export const LOCAL_CHARTING_STATS_KEY = "redux.localChartingStats";

/** Counters shown on the welcome panel. */
export interface LocalChartingStats {
  notes: number;
  events: number;
  seconds: number;
}

const ZERO_STATS: LocalChartingStats = { notes: 0, events: 0, seconds: 0 };
const listeners = new Set<() => void>();

/** Return the browser storage object when storage is available. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Clamp a persisted or computed value to a finite non-negative integer. */
function count(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

/** Read the installation-local counters, treating malformed data as empty. */
export function readLocalChartingStats(): LocalChartingStats {
  const raw = storage()?.getItem(LOCAL_CHARTING_STATS_KEY);
  if (!raw) {
    return { ...ZERO_STATS };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { ...ZERO_STATS };
    }
    const value = parsed as Record<string, unknown>;
    return {
      notes: count(value.notes),
      events: count(value.events),
      seconds: count(value.seconds),
    };
  } catch {
    return { ...ZERO_STATS };
  }
}

/** Publish the changed counters to the local storage slot and subscribers. */
function writeLocalChartingStats(next: LocalChartingStats): void {
  try {
    storage()?.setItem(LOCAL_CHARTING_STATS_KEY, JSON.stringify(next));
  } catch {
    // A blocked or full storage area must not interrupt editing.
  }
  for (const listener of listeners) {
    listener();
  }
}

/** Apply a signed local delta while keeping every counter non-negative. */
export function updateLocalChartingStats(delta: Partial<LocalChartingStats>): LocalChartingStats {
  const current = readLocalChartingStats();
  const next = {
    notes: count(current.notes + Number(delta.notes ?? 0)),
    events: count(current.events + Number(delta.events ?? 0)),
    seconds: count(current.seconds + Number(delta.seconds ?? 0)),
  };
  writeLocalChartingStats(next);
  return next;
}

/** Observe local counter changes made by this renderer. */
export function subscribeLocalChartingStats(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Add or subtract two note/event placement deltas. */
function addPlacement(left: PlacementStats, right: PlacementStats): PlacementStats {
  return {
    notes: left.notes + right.notes,
    events: left.events + right.events,
  };
}

/** Create the save/discard reconciliation for the currently open session. */
export function createLocalChartingStatsTracker(options: { currentEditSeconds: () => number }) {
  let session: EditorSession | null = null;
  let previousPlacement: PlacementStats = { notes: 0, events: 0 };
  let unsavedPlacement: PlacementStats = { notes: 0, events: 0 };
  let savedEditSeconds = 0;

  /** Mirror one session's placement changes into the local ledger. */
  const sync = (): void => {
    if (!session) {
      return;
    }
    const current = session.localPlacementStats;
    const delta = {
      notes: current.notes - previousPlacement.notes,
      events: current.events - previousPlacement.events,
    };
    if (delta.notes || delta.events) {
      updateLocalChartingStats(delta);
      unsavedPlacement = addPlacement(unsavedPlacement, delta);
    }
    previousPlacement = { ...current };
  };

  /** Stop tracking the previous session and start a fresh document baseline. */
  const attach = (next: EditorSession): void => {
    discard();
    session = next;
    previousPlacement = { ...next.localPlacementStats };
    unsavedPlacement = { notes: 0, events: 0 };
    savedEditSeconds = 0;
    next.addEventListener("change", sync);
  };

  /** Confirm all current local changes and add the active time since save. */
  const markSaved = (): void => {
    sync();
    if (!session) {
      return;
    }
    const currentSeconds = count(options.currentEditSeconds());
    if (currentSeconds < savedEditSeconds) {
      savedEditSeconds = 0;
    }
    updateLocalChartingStats({ seconds: currentSeconds - savedEditSeconds });
    savedEditSeconds = currentSeconds;
    unsavedPlacement = { notes: 0, events: 0 };
  };

  /** Roll back local placement changes that have not reached a successful save. */
  const discard = (): void => {
    if (!session) {
      return;
    }
    sync();
    if (unsavedPlacement.notes || unsavedPlacement.events) {
      updateLocalChartingStats({
        notes: -unsavedPlacement.notes,
        events: -unsavedPlacement.events,
      });
    }
    session.removeEventListener("change", sync);
    session = null;
    previousPlacement = { notes: 0, events: 0 };
    unsavedPlacement = { notes: 0, events: 0 };
    savedEditSeconds = 0;
  };

  return { attach, markSaved, discard, sync };
}
