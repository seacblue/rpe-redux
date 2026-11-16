/** Schedules chart imports under a bounded memory budget. */
import { throwIfAborted } from "../../../core/utils/abort.ts";

/** Total estimated import memory allowed for ordinary concurrent work. */
export const IMPORT_TOTAL_MEMORY_BUDGET = 512 * 1024 * 1024;
/** Maximum estimate for an import that may run with ordinary work. */
export const IMPORT_SINGLE_TASK_MEMORY_LIMIT = 128 * 1024 * 1024;
/** Fallback estimate used when a scanner cannot measure a chart's inputs. */
export const DEFAULT_IMPORT_MEMORY_ESTIMATE = 64 * 1024 * 1024;

type TaskState = "pending" | "waiting" | "running" | "done" | "cancelled";

interface WaitingTask {
  readonly index: number;
  readonly estimate: number;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
}

/** Normalize scanner output without allowing invalid values to bypass a limit. */
export function importMemoryEstimate(estimatedBytes: number | undefined): number {
  if (estimatedBytes === undefined || !Number.isFinite(estimatedBytes) || estimatedBytes < 0) {
    return DEFAULT_IMPORT_MEMORY_ESTIMATE;
  }
  return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(estimatedBytes));
}

/**
 * Grants import permits while keeping all task rows independent and visible.
 *
 * Estimates at or below the per-task limit share the total budget. Larger
 * estimates remain queued until every ordinary task is settled, then run one
 * at a time without consuming the ordinary budget. The initial `pending`
 * state is intentional: it prevents an oversized task registered first from
 * jumping ahead before later ordinary tasks have called `acquire`.
 */
export class ImportTaskScheduler {
  private readonly estimates: readonly number[];
  private readonly states: TaskState[];
  private readonly waiting: WaitingTask[] = [];
  private runningBytes = 0;
  private runningOversized = false;

  /** Create one scheduler for one import batch. */
  constructor(estimatedBytes: readonly (number | undefined)[]) {
    this.estimates = estimatedBytes.map(importMemoryEstimate);
    this.states = this.estimates.map(() => "pending");
  }

  /** Current ordinary-budget usage; exposed for focused scheduler tests. */
  get usedBytes(): number {
    return this.runningBytes;
  }

  /** Current number of permits held by import work. */
  get runningCount(): number {
    return this.states.filter((state) => state === "running").length;
  }

  /** Wait until the task's estimate is admitted by this batch's policy. */
  acquire(index: number, signal: AbortSignal): Promise<void> {
    const estimate = this.estimates[index];
    if (estimate === undefined || this.states[index] !== "pending") {
      return Promise.reject(new Error("Import task scheduler received an invalid task index"));
    }
    try {
      throwIfAborted(signal);
    } catch (error) {
      this.states[index] = "cancelled";
      return Promise.reject(error);
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        if (this.states[index] !== "waiting") {
          return;
        }
        this.states[index] = "cancelled";
        const position = this.waiting.findIndex((task) => task.index === index);
        if (position >= 0) {
          this.waiting.splice(position, 1);
        }
        reject(Object.assign(new Error("Operation cancelled"), { name: "AbortError" }));
        this.pump();
      };
      this.states[index] = "waiting";
      this.waiting.push({ index, estimate, resolve, reject, signal, onAbort });
      signal.addEventListener("abort", onAbort, { once: true });
      this.pump();
    });
  }

  /** Release a permit after the import has fully discarded its working data. */
  release(index: number): void {
    if (this.states[index] !== "running") {
      return;
    }
    const estimate = this.estimates[index];
    this.states[index] = "done";
    if (estimate > IMPORT_SINGLE_TASK_MEMORY_LIMIT) {
      this.runningOversized = false;
    } else {
      this.runningBytes = Math.max(0, this.runningBytes - estimate);
    }
    this.pump();
  }

  /** Start every waiting task that fits, or the next deferred oversized task. */
  private pump(): void {
    if (this.runningOversized) {
      return;
    }
    let started = true;
    while (started) {
      started = false;
      const position = this.waiting.findIndex(
        (task) =>
          task.estimate <= IMPORT_SINGLE_TASK_MEMORY_LIMIT &&
          this.runningBytes + task.estimate <= IMPORT_TOTAL_MEMORY_BUDGET,
      );
      if (position >= 0) {
        this.start(this.waiting.splice(position, 1)[0]);
        started = true;
      }
    }
    if (
      this.runningBytes === 0 &&
      this.waiting.every((task) => task.estimate > IMPORT_SINGLE_TASK_MEMORY_LIMIT) &&
      this.states
        .map((state, index) => ({ state, estimate: this.estimates[index] }))
        .filter(({ estimate }) => estimate <= IMPORT_SINGLE_TASK_MEMORY_LIMIT)
        .every(({ state }) => state === "done" || state === "cancelled")
    ) {
      const position = this.waiting.findIndex(
        (task) => task.estimate > IMPORT_SINGLE_TASK_MEMORY_LIMIT,
      );
      if (position >= 0) {
        this.start(this.waiting.splice(position, 1)[0]);
      }
    }
  }

  /** Transition a waiting task to running and resolve its permit promise. */
  private start(task: WaitingTask): void {
    task.signal.removeEventListener("abort", task.onAbort);
    this.states[task.index] = "running";
    if (task.estimate > IMPORT_SINGLE_TASK_MEMORY_LIMIT) {
      this.runningOversized = true;
    } else {
      this.runningBytes += task.estimate;
    }
    task.resolve();
  }
}
