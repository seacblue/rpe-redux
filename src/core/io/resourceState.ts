/**
 * Observable load/fallback state for a local resource.
 *
 * Surfaces need the same four answers before they paint: is this the first load
 * (show a skeleton), is a refresh running over existing data (keep the data),
 * did the refresh fail while a previous value can still be shown, or is there
 * nothing usable. The store owns those transitions and cancellation; the
 * surface owns the skeleton, stale badge, and retry affordance.
 */

/** Lifecycle of one resource load. */
export type ResourcePhase = "idle" | "loading" | "ready" | "degraded" | "failed";

/** Immutable view of the resource for React and imperative subscribers. */
export interface ResourceSnapshot<T> {
  readonly phase: ResourcePhase;
  /** Last usable value; retained through a degraded refresh. */
  readonly value: T | null;
  /** Message from the last failed load, empty after a success. */
  readonly error: string;
  /** Whether `value` predates the last failed refresh. */
  readonly stale: boolean;
  /** Increments for every started load so late results can be ignored. */
  readonly revision: number;
}

/** Loader and fallback policy for one resource. */
export interface ResourceStateOptions<T> {
  /** Performs the read; receives a signal that aborts a superseded load. */
  readonly load: (signal: AbortSignal) => Promise<T>;
  /** Value exposed before the first load; defaults to `null`. */
  readonly initial?: T | null;
  /**
   * Last-resort value for a failed load. Returning `null` keeps the failure
   * state; returning a value publishes `degraded` with `stale: true`.
   */
  readonly fallback?: (error: unknown, previous: T | null) => T | null;
  /** Convert a failure to the message shown by the surface. */
  readonly message?: (error: unknown) => string;
}

/** Current message for a thrown value. */
function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One resource with a single in-flight load at a time. */
export class ResourceState<T> {
  private readonly options: ResourceStateOptions<T>;
  private readonly listeners = new Set<() => void>();
  private snapshot: ResourceSnapshot<T>;
  private controller: AbortController | null = null;
  private inFlight: Promise<T | null> | null = null;
  private revision = 0;

  /** Create an idle store, or a store already showing `initial`. */
  constructor(options: ResourceStateOptions<T>) {
    this.options = options;
    const initial = options.initial ?? null;
    this.snapshot = Object.freeze({
      phase: initial === null ? "idle" : "ready",
      value: initial,
      error: "",
      stale: false,
      revision: 0,
    });
  }

  /** Latest immutable snapshot. */
  getSnapshot = (): ResourceSnapshot<T> => this.snapshot;

  /** Subscribe to snapshot changes; returns an unsubscribe callback. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Start a load, aborting the previous one. When a load is already running the
   * same promise is returned so a repeated click cannot start duplicate work.
   */
  load(): Promise<T | null> {
    if (this.inFlight) {
      return this.inFlight;
    }
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const revision = ++this.revision;
    const previous = this.snapshot.value;
    this.publish({
      phase: previous === null ? "loading" : "degraded",
      value: previous,
      error: "",
      stale: previous !== null,
      revision,
    });
    const task = Promise.resolve()
      .then(() => this.options.load(controller.signal))
      .then(
        (value) => {
          if (revision !== this.revision || controller.signal.aborted) {
            return this.snapshot.value;
          }
          this.publish({ phase: "ready", value, error: "", stale: false, revision });
          return value;
        },
        (error: unknown) => {
          if (revision !== this.revision || controller.signal.aborted) {
            return this.snapshot.value;
          }
          const message = (this.options.message ?? failureMessage)(error);
          const fallback = this.options.fallback?.(error, previous) ?? previous;
          if (fallback !== null) {
            this.publish({
              phase: "degraded",
              value: fallback,
              error: message,
              stale: true,
              revision,
            });
            return fallback;
          }
          this.publish({ phase: "failed", value: null, error: message, stale: false, revision });
          return null;
        },
      );
    this.inFlight = task;
    void task.finally(() => {
      if (this.inFlight === task) {
        this.inFlight = null;
      }
      if (this.controller === controller) {
        this.controller = null;
      }
    });
    return task;
  }

  /** Abort the active load; its promise resolves to the retained value. */
  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    this.inFlight = null;
  }

  /** Abort the active load and start a fresh one for a mutation or sort change. */
  reload(): Promise<T | null> {
    this.cancel();
    return this.load();
  }

  /** Replace the visible value without performing another transport read. */
  replace(value: T): void {
    this.cancel();
    const revision = ++this.revision;
    this.publish({ phase: "ready", value, error: "", stale: false, revision });
  }

  /** Abort the active load and drop subscribers. */
  dispose(): void {
    this.cancel();
    this.listeners.clear();
  }

  /** Replace the snapshot and notify subscribers. */
  private publish(snapshot: ResourceSnapshot<T>): void {
    this.snapshot = Object.freeze(snapshot);
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
