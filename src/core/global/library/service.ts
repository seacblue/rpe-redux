/**
 * Owns the connection to the local Go + SQLite service.
 *
 * One shared probe answers whether the sidecar is reachable, so callers receive
 * the same connected client; failed probes cool down briefly before retrying.
 */

import { t } from "../../../i18n/index.ts";
import { Backoff } from "../../runtime/backoff.ts";
import { isDesktop } from "../../platform/environment.ts";
import { browserDevPorts } from "../../platform/runtimePorts.ts";
import { openBrowserLibrary } from "../../platform/browser/library/browserLibrary.ts";
import { detectLocalLibrary, LocalLibrary } from "./client.ts";
import { registerLibraryInstance } from "./instances.ts";

/** A connected service client and its health payload. */
export interface LocalService {
  library: LocalLibrary;
  health: unknown;
}

let probe: Promise<LocalService | null> | null = null;
let status: LocalServiceStatus = "unknown";
/** Avoid hammering a service that is still starting while allowing recovery. */
const SERVICE_RETRY_DELAY_MS = 1_000;
let retryAfter = 0;

/** Maximum time the application shell waits for the owned sidecar to recover. */
const SERVICE_STARTUP_WAIT_MS = 8_000;

/** Connection state of the local service. */
export type LocalServiceStatus = "unknown" | "checking" | "available" | "unavailable";

/** Read the last connection state without starting a new probe. */
export function localServiceStatus(): LocalServiceStatus {
  return status;
}

/** Resolve the connected client, or `null` when the service is not answering. */
export function localService({
  refresh = false,
}: { refresh?: boolean } = {}): Promise<LocalService | null> {
  const retryUnavailable = status === "unavailable" && Date.now() >= retryAfter;
  // A production web page has no sidecar to probe. Open the OPFS-backed SQLite
  // library in its place; the browser development loop keeps using Vite's
  // injected local service above this branch.
  if (!isDesktop() && !browserDevPorts()) {
    if (refresh || !probe || retryUnavailable) {
      status = "checking";
      probe = openBrowserLibrary().then(
        (library) => {
          status = "available";
          retryAfter = 0;
          return { library, health: { ok: true } };
        },
        () => {
          status = "unavailable";
          retryAfter = Date.now() + SERVICE_RETRY_DELAY_MS;
          return null;
        },
      );
    }
    return probe;
  }
  if (refresh || !probe || retryUnavailable) {
    status = "checking";
    // Probe up to three times, then retry after a short cooldown if the sidecar
    // was still starting. A failed probe must not permanently poison this cache.
    const next = (async () => {
      const backoff = new Backoff({ initialMs: 250, maxMs: 1_000, factor: 2, jitter: 0 });
      for (let attempt = 0; attempt < 3; attempt++) {
        const found = await detectLocalLibrary();
        if (found) {
          await registerLibraryInstance(found.library).catch(() => undefined);
          return found;
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, backoff.next()));
        }
      }
      return null;
    })();
    probe = next.then(
      (found) => {
        status = found ? "available" : "unavailable";
        retryAfter = found ? 0 : Date.now() + SERVICE_RETRY_DELAY_MS;
        return found;
      },
      () => {
        status = "unavailable";
        retryAfter = Date.now() + SERVICE_RETRY_DELAY_MS;
        return null;
      },
    );
  }
  return probe;
}

/**
 * Wait for the sidecar during application startup without exposing a transient
 * probe failure to the Welcome page.
 *
 * Callers outside startup should keep using `localService()`: an already
 * mounted editor must not block on a service that is genuinely offline. The
 * startup gate is different because mounting the shell before the library is
 * ready turns one recoverable race into a misleading error toast.
 */
export async function waitForLocalService(
  timeoutMs = SERVICE_STARTUP_WAIT_MS,
): Promise<LocalService | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let found = await localService({ refresh: true });
  while (!found && Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(SERVICE_RETRY_DELAY_MS, remaining)),
    );
    found = await localService({ refresh: true });
  }
  return found;
}

/** The service client, connecting on demand. Throws when it is offline. */
export async function requireLocalService(): Promise<LocalLibrary> {
  const found = await localService();
  if (!found) {
    throw new Error(t("system.library.notRunning"));
  }
  return found.library;
}
