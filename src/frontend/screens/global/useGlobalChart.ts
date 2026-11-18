/** React snapshot of the current chart for global workspace pages. */
import { useMemo, useSyncExternalStore } from "react";
import type { Chart } from "../../../core/global/chart/chart.ts";
import { useEditorRuntime } from "../editor/workspace/runtime/composition/EditorRuntime.tsx";
import { createSessionChartSource } from "./sessionChartSource.ts";

/**
 * Subscribes to the active session chart and returns the current chart object.
 *
 * A document open or close replaces the whole session behind
 * `providers.session`, so the source follows that holder instead of capturing
 * one session while the component mounts.
 *
 * A paged chart document keeps one facade chart object across edits, so this
 * snapshot alone cannot tell React that timing or lines changed. Callers that
 * render fields derived from the chart must use `useGlobalChartRevision`.
 */
export function useGlobalChart(): Chart | null {
  const runtime = useEditorRuntime();
  const sessions = runtime?.providers.session ?? null;
  const source = useMemo(() => createSessionChartSource(sessions), [sessions]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
}

/**
 * The current chart together with its content revision.
 *
 * The revision changes on every commit, so derived views re-render even when a
 * paged document kept the same facade object. Use this wherever a page renders
 * data read out of the chart rather than only passing the chart along.
 */
export function useGlobalChartRevision(): { chart: Chart | null; revision: number } {
  const runtime = useEditorRuntime();
  const sessions = runtime?.providers.session ?? null;
  const source = useMemo(() => createSessionChartSource(sessions), [sessions]);
  const chart = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const revision = useSyncExternalStore(source.subscribe, source.getRevision, source.getRevision);
  return { chart, revision };
}
