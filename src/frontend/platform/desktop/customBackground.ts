/**
 * Desktop storage for user-chosen background images.
 *
 * Bytes are written outside chart and library storage and read back by the
 * reference the settings value keeps.
 */
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../../../core/platform/environment.ts";

/** Persist a validated image outside chart and library storage. */
export async function saveCustomBackground(name: string, bytes: Uint8Array): Promise<string> {
  return invoke<string>("save_custom_background", {
    name,
    bytes: Array.from(bytes),
  });
}

/** Remove one no-longer-referenced background from application data. */
export function deleteCustomBackground(reference: string): Promise<void> {
  return invoke<void>("delete_custom_background", { reference });
}

/** Remove every saved background except the one still referenced by settings. */
export function cleanupCustomBackgrounds(activeReference: string): Promise<void> {
  if (!isDesktop()) {
    return Promise.resolve();
  }
  return invoke<void>("cleanup_custom_backgrounds", { activeReference });
}

/** Read a previously stored custom background by its relative app-data reference. */
export async function readCustomBackground(reference: string): Promise<Uint8Array> {
  const response = await invoke<number[] | ArrayBuffer>("read_custom_background", { reference });
  return response instanceof ArrayBuffer ? new Uint8Array(response) : Uint8Array.from(response);
}
