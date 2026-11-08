/** Observable lifecycle and action contributions for background operations. */
import { Contributions } from "./contributions.ts";

/** Lifecycle of a retained background operation. */
export type LongTaskStatus = "running" | "cancelling" | "completed" | "failed" | "cancelled";

/** A retained task row; labels and stages are localization keys. */
export interface LongTask {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly stage: string;
  readonly progress: number | null;
  readonly status: LongTaskStatus;
  readonly error: string;
  readonly startedAt: number;
  readonly finishedAt: number | null;
}

/** The operations available to a long-running job. */
export interface LongTaskContext {
  readonly signal: AbortSignal;
  report(stage: string, progress?: number | null): void;
  /** Change the detail shown for this task while it is active. */
  setDetail(detail: string): void;
}

/** An optional action offered beside a retained task row. */
export interface LongTaskAction {
  readonly id: string;
  readonly order: number;
  readonly label: string;
  run(): void;
}

/** Whether application startup permits background work to begin. */
export type LongTaskBootState = "loading" | "ready" | "failed";

/** Features register optional actions; there is no central action list. */
export const longTaskActions = new Contributions<LongTaskAction>();

let tasks: readonly LongTask[] = [];
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();
const removeOnSettle = new Set<string>();
let startsBlocked = false;
// Unit consumers do not mount the application entry point, so the core keeps
// its standalone default permissive until the desktop entry declares startup.
let bootState: LongTaskBootState = "ready";

/** Cancel every active task when the application cannot present its workspace. */
function cancelForStartup(): void {
  for (const [id, controller] of controllers) {
    if (!controller.signal.aborted) {
      change(id, { status: "cancelling" });
      controller.abort();
    }
  }
}

/** Gate long-task creation on the application boot state. */
export function setLongTaskBootState(next: LongTaskBootState): void {
  bootState = next;
  if (next !== "ready") {
    cancelForStartup();
  }
}

/** Prevent new long tasks during a short shutdown handoff; fail if any are active. */
export function acquireLongTaskFence(): (() => void) | null {
  if (bootState !== "ready" || startsBlocked || controllers.size > 0) {
    return null;
  }
  startsBlocked = true;
  let released = false;
  return () => {
    if (!released) {
      startsBlocked = false;
      released = true;
    }
  };
}

/** Current retained tasks, newest first. */
export function getLongTasks(): readonly LongTask[] {
  return tasks;
}
/** Subscribe to task lifecycle changes. */
export function subscribeLongTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
/** Patch one task and notify subscribers. */
function change(id: string, patch: Partial<LongTask>): void {
  tasks = tasks.map((task) => (task.id === id ? { ...task, ...patch } : task));
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Start and retain a task independently of the screen that initiated it.
 *
 * Returns the task id. Throws `long_tasks_blocked_for_update` while a shutdown
 * fence is held. The task completes, fails, or cancels through its signal.
 */
export function startLongTask(options: {
  label: string;
  detail?: string;
  stage?: string;
  run(context: LongTaskContext): Promise<void>;
}): string {
  if (bootState !== "ready") {
    throw new Error("long_tasks_blocked_for_startup");
  }
  if (startsBlocked) {
    throw new Error("long_tasks_blocked_for_update");
  }
  const id = crypto.randomUUID();
  const controller = new AbortController();
  controllers.set(id, controller);
  tasks = [
    {
      id,
      label: options.label,
      detail: options.detail ?? "",
      stage: options.stage ?? "",
      progress: null,
      status: "running",
      error: "",
      startedAt: Date.now(),
      finishedAt: null,
    },
    ...tasks,
  ];
  for (const listener of listeners) {
    listener();
  }
  const report = (stage: string, progress: number | null = null) => {
    if (!controller.signal.aborted) {
      change(id, {
        stage,
        progress: progress === null ? null : Math.max(0, Math.min(1, progress)),
      });
    }
  };
  void Promise.resolve()
    .then(() =>
      options.run({
        signal: controller.signal,
        report,
        setDetail: (detail) => change(id, { detail }),
      }),
    )
    .then(
      () =>
        change(id, {
          status: controller.signal.aborted ? "cancelled" : "completed",
          finishedAt: Date.now(),
        }),
      (error: unknown) =>
        change(id, {
          status: controller.signal.aborted ? "cancelled" : "failed",
          error: error instanceof Error ? error.message : String(error),
          finishedAt: Date.now(),
        }),
    )
    .finally(() => {
      controllers.delete(id);
      if (removeOnSettle.delete(id)) {
        dismissLongTask(id);
      }
    });
  return id;
}

/** Request cancellation; the task remains visible until it has cleaned up. */
export function cancelLongTask(id: string): void {
  const controller = controllers.get(id);
  if (controller && !controller.signal.aborted) {
    change(id, { status: "cancelling" });
    controller.abort();
  }
}

/** Remove a completed history row without interrupting active work. */
export function dismissLongTask(id: string): void {
  if (controllers.has(id)) {
    return;
  }
  tasks = tasks.filter((task) => task.id !== id);
  for (const listener of listeners) {
    listener();
  }
}

/** Remove a task row, cancelling active work and waiting for its cleanup first. */
export function removeLongTask(id: string): void {
  if (!controllers.has(id)) {
    dismissLongTask(id);
    return;
  }
  if (!removeOnSettle.has(id)) {
    removeOnSettle.add(id);
    cancelLongTask(id);
  }
}

/**
 * Report how a retained task ended: a status, an optional stage line, and an
 * optional error.
 *
 * A task whose run threw already carries its failed status, and the lifecycle
 * keeps it; this is for callers that completed the work but want the row to say
 * something the run's own report did not.
 */
export function finishLongTask(
  id: string,
  outcome: { status: LongTaskStatus; stage?: string; error?: string },
): void {
  if (!tasks.some((task) => task.id === id)) {
    return;
  }
  change(id, {
    status: outcome.status,
    ...(outcome.stage === undefined ? {} : { stage: outcome.stage }),
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
    finishedAt: Date.now(),
  });
}
