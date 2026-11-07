/**
 * The loading state machine shared by desktop and browser document opening.
 *
 * Publishes progress by stage as a subscribable value and delegates frame yielding
 * to a host installed through `installLoadingHost`; `beginLoading` hands callers a
 * tracked `LoadTask`.
 */
import { createValue } from "../../state/values.ts";
import { clamp01 } from "../../utils/numbers.ts";
import { createLateBound } from "../../utils/lateBound.ts";
import type { ChartDiagnostic } from "../chart/diagnostics.ts";

/** Ordered phases reported while a document loads. */
export type LoadStage =
  "read" | "unpack" | "parse" | "notes" | "events" | "render" | "textures" | "audio" | "ready";
/** Percent span each stage occupies; published progress never moves backward. */
const ranges: Record<LoadStage, [number, number]> = {
  read: [0, 10],
  unpack: [10, 15],
  parse: [15, 22],
  notes: [22, 45],
  events: [45, 68],
  textures: [68, 82],
  audio: [82, 96],
  render: [96, 99],
  ready: [99, 100],
};
/** Published state of the active load. */
export interface LoadingState {
  id: number;
  name: string;
  stage: LoadStage;
  percent: number;
  completed: number;
  total: number;
  status: "loading" | "complete" | "error";
  error?: string;
  /** Stable operation code shown after the human-readable explanation. */
  errorCode?: string;
  /** Actionable recovery guidance shown below the explanation. */
  errorSolution?: string;
  issues?: readonly ChartDiagnostic[];
}
const progress = createValue<LoadingState | null>({ initial: null });
let sequence = 0;
const publish = progress.set;

/** Subscribable snapshot of the active load, or `null` when idle. */
export const loadingProgress = {
  subscribe: progress.subscribe,
  getSnapshot: progress.get,
  dismiss: () => progress.set(null),
};
/** Host hook that yields a frame so load progress can paint. */
export interface LoadingHost {
  paint(): Promise<void>;
}
const loadingHostBinding = createLateBound<LoadingHost>();

/** Install the host paint hook; returns a disposer that restores the previous one. */
export function installLoadingHost(next: LoadingHost): () => void {
  return loadingHostBinding.bind(next);
}

/** Yield one frame through the installed host; resolves immediately when none is bound. */
export function loadingPaint(): Promise<void> {
  return loadingHostBinding.value()?.paint() ?? Promise.resolve();
}

/** Handle that reports progress for one load and ignores updates once it settles. */
export interface LoadTask {
  id: number;
  update(stage: LoadStage, completed?: number, total?: number): void;
  complete(): void;
  fail(error: unknown, issues?: readonly ChartDiagnostic[]): void;
}
/** Start a tracked load under a display name and publish its initial state. */
export function beginLoading(name: string): LoadTask {
  const id = ++sequence;
  publish({ id, name, stage: "read", percent: 0, completed: 0, total: 0, status: "loading" });
  /** Return this task's state only while it is still the active load. */
  const activeState = () => {
    const current = progress.get();
    return current?.id === id && current.status === "loading" ? current : null;
  };
  return {
    id,
    update(stage, completed = 0, total = 0) {
      const current = activeState();
      if (!current) {
        return;
      }
      const [start, end] = ranges[stage];
      const ratio = total > 0 ? clamp01(completed / total) : 0;
      const percent = Math.max(current.percent, start + (end - start) * ratio);
      publish({ ...current, stage, percent, completed, total });
    },
    complete() {
      const current = activeState();
      if (!current) {
        return;
      }
      publish({
        ...current,
        stage: "ready",
        percent: 100,
        completed: 1,
        total: 1,
        status: "complete",
      });
    },
    fail(error, issues) {
      const current = activeState();
      if (!current) {
        return;
      }
      const embeddedIssues =
        error && typeof error === "object" && "issues" in error
          ? (error as { issues?: unknown }).issues
          : undefined;
      const resolvedIssues =
        issues ??
        (Array.isArray(embeddedIssues) ? (embeddedIssues as ChartDiagnostic[]) : undefined);
      const errorRecord =
        error && typeof error === "object"
          ? (error as { code?: unknown; solution?: unknown })
          : undefined;
      publish({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        errorCode: typeof errorRecord?.code === "string" ? errorRecord.code : undefined,
        errorSolution: typeof errorRecord?.solution === "string" ? errorRecord.solution : undefined,
        issues: resolvedIssues?.length ? resolvedIssues : undefined,
      });
    },
  };
}
