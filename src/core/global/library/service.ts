/**
 * Owns the connection to the local Go + SQLite service.
 *
 * One shared probe answers whether the sidecar is reachable, so callers receive
 * the same connected client until a refresh is requested.
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
  // A production web page has no sidecar to probe. Open the OPFS-backed SQLite
  // library in its place; the browser development loop keeps using Vite's
  // injected local service above this branch.
  if (!isDesktop() && !browserDevPorts()) {
    if (refresh || !probe) {
      status = "checking";
      probe = openBrowserLibrary().then(
        (library) => {
          status = "available";
          return { library, health: { ok: true } };
        },
        () => {
          status = "unavailable";
          return null;
        },
      );
    }
    return probe;
  }
  if (refresh || !probe) {
    status = "checking";
    // Probe up to three times, then cache the answer until a refresh is requested.
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
        return found;
      },
      () => {
        status = "unavailable";
        return null;
      },
    );
  }
  return probe;
}

/** The service client, connecting on demand. Throws when it is offline. */
export async function requireLocalService(): Promise<LocalLibrary> {
  const found = await localService();
  if (!found) {
    throw new Error(t("system.library.notRunning"));
  }
  return found.library;
}
