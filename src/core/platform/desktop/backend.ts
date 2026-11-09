/**
 * The Tauri command that starts the bundled Go service.
 *
 * Resolves only after the host-side health check passes.
 */
import { invoke } from "@tauri-apps/api/core";
import { setLibraryInstanceId } from "../../global/library/instances.ts";
import { isDesktop } from "../environment.ts";

/**
 * Resolves only when the desktop-owned backend has passed its health check.
 *
 * The browser development loop starts the same service before Vite, so the
 * page has nothing to spawn and resolves immediately outside the desktop host.
 */
export function startBackend(): Promise<void> {
  return isDesktop() ? invoke("start_backend") : Promise.resolve();
}

/** Adopt the host-generated instance id used by backend occupancy. */
export async function prepareBackendInstance(): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  const id = await invoke<string>("backend_instance_id").catch(() => null);
  if (id) {
    setLibraryInstanceId(id);
  }
}
