/**
 * Registers this editor window with the shared local backend and keeps its
 * heartbeat alive. Document occupancy belongs to the backend, which expires an
 * instance that stops heartbeating so a crash does not block a chart forever.
 */
import type { LocalLibrary } from "./client.ts";
import { getRuntimePorts } from "../../platform/runtimePorts.ts";

/** Interval between instance heartbeats. */
const HEARTBEAT_MS = 10_000;

let instanceId: string | null = null;
let registered = false;
let timer: ReturnType<typeof setInterval> | null = null;
let pending: Promise<string> | null = null;

/** Generate the fallback instance id when `crypto.randomUUID` is unavailable. */
function createId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `instance-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Adopt the host-generated id before the first registration. */
export function setLibraryInstanceId(id: string): void {
  if (registered || pending) {
    return;
  }
  instanceId = id;
}

/** The id this window sends with occupancy requests. */
export function currentInstanceId(): string {
  instanceId ??= createId();
  return instanceId;
}

/** Heartbeat on an interval; a failed beat marks the instance for re-registration. */
function scheduleHeartbeat(library: LocalLibrary): void {
  if (timer !== null) {
    return;
  }
  timer = setInterval(() => {
    void library.instancesHeartbeat(currentInstanceId(), { timeoutMs: 2_000 }).catch(() => {
      registered = false;
      void registerLibraryInstance(library).catch(() => undefined);
    });
  }, HEARTBEAT_MS);
}

/** Register once, sharing the in-flight registration between callers. */
export function registerLibraryInstance(library: LocalLibrary): Promise<string> {
  if (registered) {
    return Promise.resolve(currentInstanceId());
  }
  if (pending) {
    return pending;
  }
  const id = currentInstanceId();
  pending = library
    .instancesRegister(
      {
        id,
        label: "RPE Redux",
        frontendPort: getRuntimePorts().frontendPort,
      },
      { timeoutMs: 2_000 },
    )
    .then(() => {
      registered = true;
      scheduleHeartbeat(library);
      return id;
    })
    .catch((error) => {
      pending = null;
      throw error;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
