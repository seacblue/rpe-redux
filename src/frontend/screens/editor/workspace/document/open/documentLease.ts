/**
 * Per-document occupancy across editor instances.
 *
 * The backend owns the lock table; this manager keeps the current window's key,
 * acquires a replacement lease without dropping the old one, and only commits
 * after the document replacement succeeds.
 */
import {
  LocalLibraryError,
  type BackendInstance,
  type LocalLibrary,
  type OccupancyAcquireInput,
} from "../../../../../../core/global/library/client.ts";
import { currentInstanceId } from "../../../../../../core/global/library/instances.ts";
import { getRuntimePorts } from "../../../../../../core/platform/runtimePorts.ts";
import { cachedNormalizePath } from "../../../../../../core/io/pathCache.ts";

/** Cross-instance handle for one document replacement attempt. */
export interface DocumentLeaseHandle {
  /** The replacement succeeded: release the previous document's lease. */
  commit(): Promise<void>;
  /** The replacement was abandoned: release only the newly acquired lease. */
  cancel(): Promise<void>;
}

/** Acquired handle, or the instance currently occupying the document. */
export type DocumentLeaseResult =
  | { readonly status: "acquired"; readonly handle: DocumentLeaseHandle }
  | {
      readonly status: "occupied";
      readonly documentKey: string;
      readonly chartName: string;
      readonly backendId: string;
      /** TCP port of the backend that arbitrates this document. */
      readonly backendPort: number;
      readonly owner: BackendInstance;
    };

/** Occupancy operations for the current window and its backend lock table. */
export interface DocumentLeaseManager {
  tryAcquire(documentKey: string | null, chartName: string): Promise<DocumentLeaseResult>;
  releaseCurrent(): Promise<void>;
  clearFrontend(instanceId: string): Promise<number>;
  clearBackend(documentKey: string): Promise<boolean>;
  reconcile(documentKey: string): Promise<boolean>;
  currentKey(): string | null;
}

interface DocumentLeaseDependencies {
  readonly library: () => Promise<LocalLibrary | null>;
  readonly instanceId?: () => string;
}

/** Extracts the occupying instance from an `occupied` error payload. */
function conflictFrom(details: unknown): { backendId: string; owner: BackendInstance } | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }
  const record = details as Record<string, unknown>;
  const owner = record.owner;
  if (!owner || typeof owner !== "object" || Array.isArray(owner)) {
    return null;
  }
  const instance = owner as Record<string, unknown>;
  if (typeof instance.id !== "string") {
    return null;
  }
  return {
    backendId: typeof record.backendId === "string" ? record.backendId : "",
    owner: {
      id: instance.id,
      label: typeof instance.label === "string" ? instance.label : "",
      frontendPort: typeof instance.frontendPort === "number" ? instance.frontendPort : undefined,
      pid: typeof instance.pid === "number" ? instance.pid : 0,
      startedAt: typeof instance.startedAt === "string" ? instance.startedAt : "",
      heartbeatAt: typeof instance.heartbeatAt === "string" ? instance.heartbeatAt : "",
    },
  };
}

/** Reads the TCP port from one library origin, defaulting to the scheme's port. */
export function originPort(origin: string): number {
  try {
    const url = new URL(origin);
    if (url.port) {
      return Number(url.port);
    }
    return url.protocol === "https:" ? 443 : 80;
  } catch {
    return 0;
  }
}

/** A handle for paths that need no lock. */
function noopHandle(): DocumentLeaseHandle {
  return {
    async commit() {
      /* no lock was needed */
    },
    async cancel() {
      /* no lock was needed */
    },
  };
}

/** Builds the occupancy manager and tracks this window's current key. */
export function createDocumentLeaseManager(deps: DocumentLeaseDependencies): DocumentLeaseManager {
  const instanceId = deps.instanceId ?? currentInstanceId;
  let current: string | null = null;

  /** Releases a key, ignoring a backend that is already gone. */
  const release = async (library: LocalLibrary, key: string): Promise<void> => {
    await library
      .occupancyRelease({ documentKey: key, instanceId: instanceId() }, { timeoutMs: 2_000 })
      .catch(() => undefined);
  };

  /** Tries to reserve a document key without releasing the current lease. */
  const tryAcquire = async (
    documentKey: string | null,
    chartName: string,
  ): Promise<DocumentLeaseResult> => {
    if (documentKey === null || documentKey === current) {
      return {
        status: "acquired",
        handle: {
          async commit() {
            if (documentKey !== null) {
              return;
            }
            const library = await deps.library();
            const previous = current;
            current = null;
            if (library && previous) {
              await release(library, previous);
            }
          },
          async cancel() {
            /* the current lease stays with the open document */
          },
        },
      };
    }
    const library = await deps.library();
    if (!library) {
      return { status: "acquired", handle: noopHandle() };
    }
    const input: OccupancyAcquireInput = {
      documentKey,
      instanceId: instanceId(),
      chartName,
      label: "RPE Redux",
      frontendPort: getRuntimePorts().frontendPort,
    };
    try {
      await library.occupancyAcquire(input, { timeoutMs: 3_000 });
    } catch (error) {
      if (error instanceof LocalLibraryError && error.code === "occupied") {
        const conflict = conflictFrom(error.details);
        if (conflict) {
          return {
            status: "occupied",
            documentKey,
            chartName,
            backendId: conflict.backendId,
            backendPort: originPort(library.origin),
            owner: conflict.owner,
          };
        }
      }
      // A backend that is not reachable cannot arbitrate; keep the editor
      // usable and let the next open attempt retry the lease.
      return { status: "acquired", handle: noopHandle() };
    }
    let settled = false;
    return {
      status: "acquired",
      handle: {
        async commit() {
          if (settled) {
            return;
          }
          settled = true;
          const previous = current;
          current = documentKey;
          if (previous && previous !== documentKey) {
            await release(library, previous);
          }
        },
        async cancel() {
          if (settled) {
            return;
          }
          settled = true;
          await release(library, documentKey);
        },
      },
    };
  };

  return {
    tryAcquire,
    async releaseCurrent() {
      const key = current;
      current = null;
      if (!key) {
        return;
      }
      const library = await deps.library();
      if (library) {
        await release(library, key);
      }
    },
    async clearFrontend(instanceIdToClear) {
      const library = await deps.library();
      if (!library) {
        return 0;
      }
      const result = await library
        .instancesClear(instanceIdToClear, { timeoutMs: 3_000 })
        .catch(() => ({ cleared: 0 }));
      return result.cleared;
    },
    async clearBackend(documentKey) {
      const library = await deps.library();
      if (!library) {
        return false;
      }
      const result = await library
        .occupancyClearBackend(documentKey, { timeoutMs: 3_000 })
        .catch(() => ({ cleared: false }));
      return result.cleared;
    },
    async reconcile(documentKey) {
      const library = await deps.library();
      if (!library) {
        return false;
      }
      const result = await library
        .occupancyReconcile({ documentKey, instanceId: instanceId() }, { timeoutMs: 3_000 })
        .catch(() => null);
      if (result?.available) {
        return true;
      }
      await library.instancesPrune({ timeoutMs: 2_000 }).catch(() => undefined);
      return false;
    },
    currentKey: () => current,
  };
}

/** A stable key for a native file path. */
export function documentKeyForPath(path: string): string {
  return `file:${cachedNormalizePath(path)}`;
}

/** A stable key for a library project. */
export function documentKeyForProject(projectId: string): string {
  return `library:${projectId}`;
}

/** The key for a candidate opened from bytes, when the name is meaningful. */
export function documentKeyForCandidateName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed && trimmed !== "chart.json" ? `bytes:${trimmed.toLowerCase()}` : null;
}
