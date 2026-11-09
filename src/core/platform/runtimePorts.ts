/** Host-neutral cache for the native runtime ports used by frontend clients. */

import { browserDevRuntime } from "./browser/devRuntime.ts";

export interface RuntimePorts {
  frontendPort: number;
  backendPort: number;
  aiPort: number;
  /** Loopback port of the embedded collaboration room server. */
  collabPort: number;
}

export const DEFAULT_RUNTIME_PORTS: RuntimePorts = Object.freeze({
  frontendPort: 4173,
  backendPort: 47821,
  aiPort: 47822,
  collabPort: 47830,
});

const injected = browserDevRuntime()?.ports;

let current: RuntimePorts = injected
  ? Object.freeze({ ...DEFAULT_RUNTIME_PORTS, ...injected })
  : DEFAULT_RUNTIME_PORTS;

/** Read the most recently adopted runtime port configuration. */
export function getRuntimePorts(): RuntimePorts {
  return current;
}

/** Whether the browser development server supplied the worktree's fixed ports. */
export function browserDevPorts(): boolean {
  return browserDevRuntime() !== null;
}

/** Adopt the native configuration before constructing local service clients. */
export function setRuntimePorts(next: RuntimePorts): RuntimePorts {
  current = Object.freeze({ ...next });
  return current;
}
