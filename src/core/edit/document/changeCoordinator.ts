/** Serializes document changes and tracks the revisions they coordinate. */

import type { CoordinatedRevisions } from "../../contracts/revisions.ts";

export type { CoordinatedRevisions, DocumentRevisions } from "../../contracts/revisions.ts";

export type DocumentLifecycle = "closed" | "opening" | "open";
export type DocumentOperation = "idle" | "rescan" | "applying" | "saving";
export type DocumentSource = "unknown" | "synced" | "external-pending" | "conflict";
export type ChangeKind = "ui" | "history" | "code-cell" | "disk" | "save";

export interface ChangeOrigin {
  readonly kind: string;
  readonly clientId?: string;
  readonly requestId?: string;
}

export interface PendingChange {
  readonly id: string;
  readonly kind: ChangeKind;
  readonly origin?: ChangeOrigin;
  readonly base: Readonly<DocumentRevisionExpectation>;
  readonly payload: unknown;
}

export interface PendingChangeInput {
  readonly kind: ChangeKind;
  readonly origin?: ChangeOrigin;
  readonly base: Readonly<DocumentRevisionExpectation>;
  readonly payload: unknown;
}

export interface DocumentCoordinationState {
  readonly lifecycle: DocumentLifecycle;
  readonly operation: DocumentOperation;
  readonly source: DocumentSource;
  readonly revisions: Readonly<CoordinatedRevisions>;
  readonly dirty: boolean;
  readonly pendingChanges: readonly PendingChange[];
}

export interface DocumentLoad {
  readonly chartFingerprint: string;
  readonly diskSnapshot?: string | null;
  readonly savedChartFingerprint?: string | null;
}

export interface DocumentRevisionExpectation {
  readonly chartFingerprint?: string | null;
  readonly diskSnapshot?: string | null;
  readonly generation?: number;
}

export interface ChangeRevisionUpdate {
  readonly chartFingerprint?: string | null;
  readonly savedChartFingerprint?: string | null;
  readonly diskSnapshot?: string | null;
  readonly source?: DocumentSource;
}

export interface ChangeContext {
  readonly kind: ChangeKind;
  readonly state: DocumentCoordinationState;
  /** Returns false after the document has been replaced or closed. */
  readonly isCurrent: () => boolean;
}

export type ChangeDecision<T> =
  | {
      readonly status: "accepted";
      readonly value?: T;
      readonly revisions?: ChangeRevisionUpdate;
    }
  | {
      readonly status: "rejected";
      readonly reason: string;
      readonly message?: string;
    };

export interface ChangeRequest<T> {
  readonly kind: ChangeKind;
  readonly expected?: DocumentRevisionExpectation;
  readonly origin?: ChangeOrigin;
  readonly payload?: unknown;
  readonly pendingId?: string;
  readonly run: (context: ChangeContext) => ChangeDecision<T> | Promise<ChangeDecision<T>>;
}

export interface SynchronousChangeRequest<T> {
  readonly kind: Extract<ChangeKind, "ui" | "history" | "save">;
  readonly run: () => T;
  readonly revisions?: () => ChangeRevisionUpdate | undefined;
}

export type ChangeResult<T> =
  | {
      readonly status: "accepted";
      readonly value: T | undefined;
      readonly state: DocumentCoordinationState;
    }
  | {
      readonly status: "rejected";
      readonly reason: string;
      readonly message?: string;
      /**
       * The original rejection, so a caller that has to act on the failure keeps
       * the error's identity, code, and cause instead of only its message.
       */
      readonly error?: unknown;
      readonly state: DocumentCoordinationState;
    }
  | {
      readonly status: "stale";
      readonly requestedGeneration: number;
      readonly currentGeneration: number;
      readonly state: DocumentCoordinationState;
    }
  | {
      readonly status: "conflict";
      readonly conflicts: readonly ("chartFingerprint" | "diskSnapshot")[];
      readonly state: DocumentCoordinationState;
    };

export interface DocumentChangeCoordinatorOptions {
  readonly initial?: Partial<DocumentLoad> & {
    readonly generation?: number;
    readonly lifecycle?: DocumentLifecycle;
    readonly source?: DocumentSource;
  };
}

export interface DocumentLoadHandle {
  readonly generation: number;
  readonly isCurrent: () => boolean;
  readonly complete: (loadedDocument: DocumentLoad) => boolean;
  /** Return to the document that was open before this load started. */
  readonly restore: () => boolean;
  readonly cancel: () => boolean;
}

/** Builds the frozen coordination state, deriving the dirty flag. */
function freezeState(
  lifecycle: DocumentLifecycle,
  operation: DocumentOperation,
  source: DocumentSource,
  revisions: CoordinatedRevisions,
  pendingChanges: readonly PendingChange[],
): DocumentCoordinationState {
  const frozenRevisions = Object.freeze(revisions);
  const frozenPendingChanges = Object.freeze(pendingChanges);
  return Object.freeze({
    lifecycle,
    operation,
    source,
    revisions: frozenRevisions,
    pendingChanges: frozenPendingChanges,
    dirty:
      frozenRevisions.chartFingerprint !== null &&
      frozenRevisions.chartFingerprint !== frozenRevisions.savedChartFingerprint,
  });
}

/** Derives the starting state from the coordinator options. */
function initialState(options: DocumentChangeCoordinatorOptions): DocumentCoordinationState {
  const initial = options.initial;
  const chartFingerprint = initial?.chartFingerprint ?? null;
  const lifecycle = initial?.lifecycle ?? (chartFingerprint === null ? "closed" : "open");
  const generation = initial?.generation ?? (lifecycle === "closed" ? 0 : 1);
  const savedChartFingerprint =
    initial?.savedChartFingerprint === undefined ? chartFingerprint : initial.savedChartFingerprint;
  const diskSnapshot = initial?.diskSnapshot ?? null;
  const source =
    initial?.source ?? (lifecycle === "closed" || diskSnapshot === null ? "unknown" : "synced");
  return freezeState(
    lifecycle,
    "idle",
    source,
    {
      chartFingerprint,
      savedChartFingerprint,
      diskSnapshot,
      generation,
    },
    [],
  );
}

/** Maps a change kind to the operation shown while it runs. */
function operationFor(kind: ChangeKind): DocumentOperation {
  if (kind === "disk") {
    return "rescan";
  }
  if (kind === "save") {
    return "saving";
  }
  return "applying";
}

/** Lists revision fields whose expected value differs from the current state. */
function mismatch(
  state: DocumentCoordinationState,
  expected: DocumentRevisionExpectation,
): readonly ("chartFingerprint" | "diskSnapshot")[] {
  const conflicts: ("chartFingerprint" | "diskSnapshot")[] = [];
  if (
    expected.chartFingerprint !== undefined &&
    expected.chartFingerprint !== state.revisions.chartFingerprint
  ) {
    conflicts.push("chartFingerprint");
  }
  if (
    expected.diskSnapshot !== undefined &&
    expected.diskSnapshot !== state.revisions.diskSnapshot
  ) {
    conflicts.push("diskSnapshot");
  }
  return Object.freeze(conflicts);
}

/** Builds the serialized document-change coordinator over an optional initial state. */
export function createDocumentChangeCoordinator(options: DocumentChangeCoordinatorOptions = {}) {
  let state = initialState(options);
  let queue: Promise<unknown> = Promise.resolve();
  let activeExecutionDepth = 0;
  let nextPendingId = 1;
  const listeners = new Set<(state: DocumentCoordinationState) => void>();

  /** Installs and broadcasts one coordination state. */
  const publish = (next: DocumentCoordinationState): void => {
    state = next;
    for (const listener of [...listeners]) {
      listener(state);
    }
  };

  /** Publishes an idle document state for a lifecycle and revision set. */
  const setDocumentState = (
    lifecycle: DocumentLifecycle,
    revisions: CoordinatedRevisions,
    source: DocumentSource,
  ): void => publish(freezeState(lifecycle, "idle", source, revisions, state.pendingChanges));

  /** Removes one pending change from the state. */
  const releasePending = (id: string): void => {
    if (!state.pendingChanges.some((pending) => pending.id === id)) {
      return;
    }
    publish(
      freezeState(
        state.lifecycle,
        state.operation,
        state.source,
        state.revisions,
        state.pendingChanges.filter((pending) => pending.id !== id),
      ),
    );
  };

  /** Registers a pending change and returns its frozen record and release. */
  const trackPending = (input: PendingChangeInput) => {
    const change = Object.freeze({
      id: `pending-${nextPendingId++}`,
      kind: input.kind,
      ...(input.origin ? { origin: Object.freeze({ ...input.origin }) } : {}),
      base: Object.freeze({ ...input.base }),
      payload: input.payload,
    });
    publish(
      freezeState(state.lifecycle, state.operation, state.source, state.revisions, [
        ...state.pendingChanges,
        change,
      ]),
    );
    let released = false;
    return Object.freeze({
      change,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        releasePending(change.id);
      },
    });
  };

  /** Starts a new document generation and returns its completion handle. */
  const beginOpen = (): DocumentLoadHandle => {
    const previousState = state;
    const generation = state.revisions.generation + 1;
    setDocumentState(
      "opening",
      {
        chartFingerprint: null,
        savedChartFingerprint: null,
        diskSnapshot: null,
        generation,
      },
      "unknown",
    );
    const isCurrent = (): boolean =>
      state.lifecycle === "opening" && state.revisions.generation === generation;
    return {
      generation,
      isCurrent,
      complete(loadedDocument: DocumentLoad): boolean {
        if (!isCurrent()) {
          return false;
        }
        setDocumentState(
          "open",
          {
            chartFingerprint: loadedDocument.chartFingerprint,
            savedChartFingerprint:
              loadedDocument.savedChartFingerprint ?? loadedDocument.chartFingerprint,
            diskSnapshot: loadedDocument.diskSnapshot ?? null,
            generation,
          },
          loadedDocument.diskSnapshot === null || loadedDocument.diskSnapshot === undefined
            ? "unknown"
            : "synced",
        );
        return true;
      },
      restore(): boolean {
        if (!isCurrent()) {
          return false;
        }
        publish(previousState);
        return true;
      },
      cancel(): boolean {
        if (!isCurrent()) {
          return false;
        }
        setDocumentState(
          "closed",
          {
            chartFingerprint: null,
            savedChartFingerprint: null,
            diskSnapshot: null,
            generation,
          },
          "unknown",
        );
        return true;
      },
    };
  };

  /** Installs an already loaded document and returns its generation. */
  const replaceDocument = (loadedDocument: DocumentLoad): number => {
    const load = beginOpen();
    load.complete(loadedDocument);
    return load.generation;
  };

  /** Closes the document, invalidating older generations. */
  const closeDocument = (): number => {
    const generation = state.revisions.generation + 1;
    setDocumentState(
      "closed",
      {
        chartFingerprint: null,
        savedChartFingerprint: null,
        diskSnapshot: null,
        generation,
      },
      "unknown",
    );
    return generation;
  };

  /** Runs one queued change after generation and revision checks. */
  const execute = async <T>(
    request: ChangeRequest<T>,
    enqueuedGeneration: number,
  ): Promise<ChangeResult<T>> => {
    const expected = {
      ...request.expected,
      generation: request.expected?.generation ?? enqueuedGeneration,
    };
    if (state.revisions.generation !== expected.generation) {
      return {
        status: "stale",
        requestedGeneration: expected.generation,
        currentGeneration: state.revisions.generation,
        state,
      };
    }
    if (state.lifecycle !== "open") {
      return {
        status: "rejected",
        reason: state.lifecycle === "opening" ? "document_opening" : "no_document",
        state,
      };
    }
    const conflicts = mismatch(state, expected);
    if (conflicts.length) {
      return { status: "conflict", conflicts, state };
    }
    const before = state;
    publish(
      freezeState(
        before.lifecycle,
        operationFor(request.kind),
        before.source,
        before.revisions,
        before.pendingChanges,
      ),
    );
    const context: ChangeContext = {
      kind: request.kind,
      state: before,
      isCurrent: () => state.revisions.generation === enqueuedGeneration,
    };
    let decision: ChangeDecision<T>;
    try {
      activeExecutionDepth += 1;
      decision = await request.run(context);
    } catch (error) {
      decision = {
        status: "rejected",
        reason: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      activeExecutionDepth -= 1;
    }
    if (!context.isCurrent()) {
      return {
        status: "stale",
        requestedGeneration: enqueuedGeneration,
        currentGeneration: state.revisions.generation,
        state,
      };
    }
    if (decision.status === "rejected") {
      publish(
        freezeState(state.lifecycle, "idle", state.source, state.revisions, state.pendingChanges),
      );
      return { ...decision, state };
    }

    const { source: requestedSource, ...revisionUpdate } = decision.revisions ?? {};
    const updatedRevisions = {
      ...state.revisions,
      ...revisionUpdate,
    };
    const chartChanged = updatedRevisions.chartFingerprint !== state.revisions.chartFingerprint;
    const nextSource =
      requestedSource ??
      (chartChanged && state.source === "external-pending" ? "conflict" : state.source);
    publish(
      freezeState(state.lifecycle, "idle", nextSource, updatedRevisions, state.pendingChanges),
    );
    return { status: "accepted", value: decision.value, state };
  };

  /** Runs a UI, history, or save mutation synchronously and reports its revisions. */
  const admitSync = <T>(request: SynchronousChangeRequest<T>): T => {
    if (activeExecutionDepth > 0) {
      const value = request.run();
      const revisions = request.revisions?.();
      if (revisions) {
        const { source: requestedSource, ...revisionUpdate } = revisions;
        const updatedRevisions = { ...state.revisions, ...revisionUpdate };
        publish(
          freezeState(
            state.lifecycle,
            state.operation,
            requestedSource ?? state.source,
            updatedRevisions,
            state.pendingChanges,
          ),
        );
      }
      return value;
    }

    const before = state;
    publish(
      freezeState(
        before.lifecycle,
        operationFor(request.kind),
        before.source,
        before.revisions,
        before.pendingChanges,
      ),
    );
    activeExecutionDepth += 1;
    try {
      const value = request.run();
      const revisions = request.revisions?.();
      const { source: requestedSource, ...revisionUpdate } = revisions ?? {};
      const updatedRevisions = { ...state.revisions, ...revisionUpdate };
      publish(
        freezeState(
          state.lifecycle,
          "idle",
          requestedSource ?? state.source,
          updatedRevisions,
          state.pendingChanges,
        ),
      );
      return value;
    } catch (error) {
      publish(
        freezeState(state.lifecycle, "idle", state.source, state.revisions, state.pendingChanges),
      );
      throw error;
    } finally {
      activeExecutionDepth -= 1;
    }
  };

  /** Queues one change and resolves with its outcome and final state. */
  const submit = <T>(request: ChangeRequest<T>): Promise<ChangeResult<T>> => {
    const enqueuedGeneration = state.revisions.generation;
    const pending = request.pendingId
      ? null
      : trackPending({
          kind: request.kind,
          origin: request.origin,
          base: {
            chartFingerprint:
              request.expected?.chartFingerprint ?? state.revisions.chartFingerprint,
            diskSnapshot: request.expected?.diskSnapshot ?? state.revisions.diskSnapshot,
            generation: request.expected?.generation ?? enqueuedGeneration,
          },
          payload: request.payload,
        });
    const result = queue.then(
      () => execute(request, enqueuedGeneration),
      () => execute(request, enqueuedGeneration),
    );
    const settled = result.then(
      (outcome) => {
        pending?.release();
        if (request.pendingId) {
          releasePending(request.pendingId);
        }
        return { ...outcome, state };
      },
      (error) => {
        pending?.release();
        if (request.pendingId) {
          releasePending(request.pendingId);
        }
        throw error;
      },
    );
    queue = settled.then(
      () => undefined,
      () => undefined,
    );
    return settled;
  };

  /** Queues a document replacement that runs under a new generation. */
  const submitReplacement = <T>(
    run: (load: DocumentLoadHandle) => T | Promise<T>,
    expected?: DocumentRevisionExpectation,
  ): Promise<ChangeResult<T>> => {
    const result = queue.then(async () => {
      const requestedGeneration = expected?.generation ?? state.revisions.generation;
      if (state.revisions.generation !== requestedGeneration) {
        return {
          status: "stale",
          requestedGeneration,
          currentGeneration: state.revisions.generation,
          state,
        } satisfies ChangeResult<T>;
      }
      const conflicts = expected ? mismatch(state, expected) : [];
      if (conflicts.length) {
        return { status: "conflict", conflicts, state } satisfies ChangeResult<T>;
      }
      const load = beginOpen();
      try {
        const value = await run(load);
        if (state.revisions.generation !== load.generation) {
          return {
            status: "stale",
            requestedGeneration: load.generation,
            currentGeneration: state.revisions.generation,
            state,
          } satisfies ChangeResult<T>;
        }
        if (state.lifecycle !== "open") {
          return {
            status: "rejected",
            reason: "replacement_incomplete",
            state,
          } satisfies ChangeResult<T>;
        }
        return { status: "accepted", value, state } satisfies ChangeResult<T>;
      } catch (error) {
        if (state.revisions.generation === load.generation && state.lifecycle === "opening") {
          load.cancel();
        }
        return {
          status: "rejected",
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
          error,
          state,
        } satisfies ChangeResult<T>;
      }
    });
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  /** Queues a close operation after all earlier changes settle. */
  const submitClose = (
    run: (generation: number) => void | Promise<void>,
  ): Promise<ChangeResult<void>> => {
    const result = queue.then(async () => {
      const generation = closeDocument();
      try {
        await run(generation);
        return { status: "accepted", value: undefined, state } satisfies ChangeResult<void>;
      } catch (error) {
        return {
          status: "rejected",
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
          state,
        } satisfies ChangeResult<void>;
      }
    });
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  /** Admits an observed disk snapshot and marks its source. */
  const observeDisk = (diskSnapshot: string | null): Promise<ChangeResult<void>> =>
    submit({
      kind: "disk",
      origin: { kind: "disk-observer" },
      payload: { diskSnapshot },
      run: ({ state: before }) => {
        if (diskSnapshot === before.revisions.diskSnapshot) {
          return { status: "accepted", value: undefined };
        }
        return {
          status: "accepted",
          value: undefined,
          revisions: {
            diskSnapshot,
            source: before.dirty ? "conflict" : "external-pending",
          },
        };
      },
    });

  /** Subscribes to coordination state changes; returns the unsubscribe. */
  const subscribe = (listener: (state: DocumentCoordinationState) => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    snapshot: (): DocumentCoordinationState => state,
    subscribe,
    beginOpen,
    replaceDocument,
    closeDocument,
    submit,
    submitReplacement,
    submitClose,
    admitSync,
    observeDisk,
    trackPending,
  };
}

export type DocumentChangeCoordinator = ReturnType<typeof createDocumentChangeCoordinator>;
