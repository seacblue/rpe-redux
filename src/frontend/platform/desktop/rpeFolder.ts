/**
 * Adapter for reading a native RPE installation.
 *
 * The picker returns a path; the local service classifies the folder and its
 * item carries the RPE sidecars and direct chart folders under Resources. The
 * native command stays the desktop fallback. Chart bytes still flow through the
 * existing document store when the migration imports them.
 */
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../../../core/platform/environment.ts";
import { browserDevPorts } from "../../../core/platform/runtimePorts.ts";
import { localService } from "../../../core/global/library/service.ts";
import type { RpeFolderScan } from "../../../core/migration/rpe.ts";

/**
 * Read the classification details for one RPE root.
 *
 * The local service already classifies the folder, so its item carries the
 * settings and chart rows the review needs. The native command stays the
 * fallback for a desktop window that started without the sidecar.
 */
export async function readRpeFolder(path: string): Promise<RpeFolderScan> {
  if (isDesktop() || browserDevPorts()) {
    const found = await localService();
    if (found) {
      try {
        const { items } = await found.library.classifyDropped([path]);
        const details = items[0]?.details;
        if (details) {
          return details;
        }
        if (!isDesktop()) {
          throw new Error("The folder is not a classified RPE root.");
        }
      } catch (error) {
        // A desktop window can still use the native reader when its sidecar is
        // a version behind the renderer; the browser loop has no such fallback.
        if (!isDesktop()) {
          throw error;
        }
      }
    }
  }
  return invoke<RpeFolderScan>("scan_rpe_root", { path });
}
