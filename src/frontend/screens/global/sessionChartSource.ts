/**
 * Chart snapshot source for the replaceable editor session.
 *
 * Opening or closing a document installs a new session behind the session
 * runtime instead of mutating the mounted one, so a source that only listened
 * to the session captured at mount would keep showing the placeholder chart.
 * This module follows `current` and migrates its change listener after every
 * replacement, without depending on React.
 *
 * A paged chart document keeps one facade chart object across edits, so the
 * chart reference cannot signal a change on its own. `getRevision` exposes the
 * session's monotonic content revision for consumers that must re-render when
 * the same facade gained new timing, lines, or metadata.
 */
import type { Chart } from "../../../core/global/chart/chart.ts";

/** A chart-bearing session that publishes `"change"` events. */
export type ChartSession = EventTarget & {
  readonly chart: Chart;
  /** Monotonic content revision; absent on hosts that replace the chart object. */
  readonly contentRevision?: number;
};

/**
 * The replaceable session holder observed by a source.
 *
 * `EditorSessionRuntime` satisfies this shape structurally.
 */
export interface SessionChartHost {
  readonly current: ChartSession;
  /** Subscribes to replacement notifications and returns their teardown. */
  subscribe(listener: () => void): () => void;
}

/** The snapshot and subscription pair required by `useSyncExternalStore`. */
export interface SessionChartSource {
  /** The active session's chart, or null when no host is mounted. */
  getSnapshot(): Chart | null;
  /**
   * The active session's content revision.
   *
   * Consumers subscribe to this when the chart object itself can stay identical
   * across edits, as a paged document does.
   */
  getRevision(): number;
  /** Attaches one external-store listener and returns its teardown. */
  subscribe(listener: () => void): () => void;
}

/**
 * Creates a chart source over a replaceable session holder.
 *
 * A null host is valid while the editor runtime is not mounted. The first
 * subscriber binds one replacement listener plus the current session's
 * `"change"` listener; later subscribers share that binding, and the last
 * teardown releases both. `getSnapshot` always reads `host.current`, so it
 * stays live even when the source was created before the host mounted.
 */
export function createSessionChartSource(host: SessionChartHost | null): SessionChartSource {
  const listeners = new Set<() => void>();
  let boundSession: ChartSession | null = null;
  let detachReplacement: (() => void) | null = null;
  /** Notifies every external-store subscriber once. */
  const notify = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };
  /** Removes the change listener from the session it is currently bound to. */
  const detachSession = (): void => {
    boundSession?.removeEventListener("change", notify);
    boundSession = null;
  };
  /** Binds the replacement notification and the current session's changes. */
  const bind = (): void => {
    if (!host) {
      return;
    }
    boundSession = host.current;
    boundSession.addEventListener("change", notify);
    detachReplacement = host.subscribe(() => {
      if (host.current === boundSession) {
        return;
      }
      detachSession();
      boundSession = host.current;
      boundSession.addEventListener("change", notify);
      notify();
    });
  };
  /** Releases both listeners; a later subscriber binds a fresh pair. */
  const unbind = (): void => {
    detachSession();
    detachReplacement?.();
    detachReplacement = null;
  };
  return {
    getSnapshot: () => host?.current.chart ?? null,
    getRevision: () => host?.current.contentRevision ?? 0,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        bind();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unbind();
        }
      };
    },
  };
}
