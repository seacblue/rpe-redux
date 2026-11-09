/**
 * Browser development runtime settings.
 *
 * `scripts/dev.mjs` starts the Go service, then hands Vite the worktree's fixed
 * ports and the sidecar's one-process preference token. The development server
 * injects those values into the page before the module graph runs; a production
 * page never carries the record, so browser builds use the product defaults and
 * have no write credential.
 */
import type { RuntimePorts } from "../runtimePorts.ts";

/** Ports and credentials carried by the browser development page. */
export interface BrowserDevRuntime {
  readonly ports: RuntimePorts;
  readonly preferenceToken: string | null;
  readonly preferenceHeader: string;
}

/** Return the injected browser-development settings, or null in a product page. */
export function browserDevRuntime(): BrowserDevRuntime | null {
  if (typeof __REDUX_DEV_RUNTIME__ !== "object" || !__REDUX_DEV_RUNTIME__) {
    return null;
  }
  return __REDUX_DEV_RUNTIME__ as BrowserDevRuntime;
}
