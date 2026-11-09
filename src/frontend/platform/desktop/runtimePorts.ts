/** Reads and writes the next-launch ports shared by Tauri and the sidecar. */
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../../../core/platform/environment.ts";
import {
  DEFAULT_RUNTIME_PORTS,
  getRuntimePorts,
  setRuntimePorts,
  type RuntimePorts,
} from "../../../core/platform/runtimePorts.ts";
import { values } from "../../../core/state/values.ts";

export type RuntimePortName = "frontend" | "backend" | "ai";

let ready = false;
const pending = new Set<RuntimePortName>();
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Load the native port file before the first backend client is constructed. */
export async function initializeRuntimePorts(): Promise<RuntimePorts> {
  if (!isDesktop()) {
    ready = true;
    return getRuntimePorts();
  }
  try {
    setRuntimePorts({
      ...DEFAULT_RUNTIME_PORTS,
      ...(await invoke<Partial<RuntimePorts>>("read_runtime_ports")),
    });
  } catch {
    setRuntimePorts(DEFAULT_RUNTIME_PORTS);
  }
  ready = true;
  publish();
  return getRuntimePorts();
}

/** Read the cached next-launch ports. */
export function runtimePorts(): RuntimePorts {
  return getRuntimePorts();
}

/** Whether the native port configuration has finished loading. */
export function runtimePortsReady(): boolean {
  return ready;
}

/** Write one port and mark its setting as requiring a restart. */
export async function writeRuntimePort(name: RuntimePortName, port: number): Promise<void> {
  pending.add(name);
  publish();
  if (isDesktop()) {
    setRuntimePorts({
      ...getRuntimePorts(),
      ...(await invoke<Partial<RuntimePorts>>("write_runtime_port", { name, port })),
    });
  } else {
    setRuntimePorts({
      ...getRuntimePorts(),
      [`${name}Port`]: port,
    } as RuntimePorts);
  }
  publish();
}

/** Persist the port represented by one settings field after its value changes. */
export function syncRuntimePortSetting(key: string, value: string | number | boolean): void {
  const match = /^(?:general\.)?(frontend|backend|ai)-port$/.exec(key);
  if (!match || typeof value === "boolean") {
    return;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return;
  }
  void writeRuntimePort(match[1] as RuntimePortName, port).catch((error: unknown) => {
    console.error("Could not write runtime port configuration", error);
  });
}

/** Whether a settings row changed from the ports used by the current process. */
export function runtimePortPending(key: string): boolean {
  const match = /^(?:general\.)?(frontend|backend|ai)-port$/.exec(key);
  return match ? pending.has(match[1] as RuntimePortName) : false;
}

/** Subscribe to port-file and restart-marker changes. */
export function subscribeRuntimePorts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read the current value for a runtime port setting. */
export function runtimePortFor(name: RuntimePortName): number {
  return getRuntimePorts()[`${name}Port`];
}

/** Keep the settings value store aligned with the native file after startup. */
export function adoptRuntimePortSettings(): void {
  const mapping: readonly [string, RuntimePortName][] = [
    ["frontend-port", "frontend"],
    ["backend-port", "backend"],
    ["ai-port", "ai"],
  ];
  for (const [key, name] of mapping) {
    if (values.byId.has(key)) {
      values.byId.set(key, runtimePortFor(name));
    }
  }
}
