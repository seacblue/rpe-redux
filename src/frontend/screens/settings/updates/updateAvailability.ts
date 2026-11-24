/**
 * Decides whether the running host may use the self-update service.
 *
 * Browser hosts and Vite development pages never check for releases. Tauri
 * debug builds expose the native developer-mode command, while release builds
 * return false from it and remain eligible for the normal update flow.
 */
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../../../../core/platform/environment.ts";

/** Shared release-mode probe; non-release hosts never contact the update service. */
let releaseDesktopBuild: Promise<boolean> | null = null;

/** Whether this is a packaged release desktop build allowed to update itself. */
export function isReleaseDesktopBuild(): Promise<boolean> {
  if (!isDesktop() || import.meta.env?.DEV === true) {
    return Promise.resolve(false);
  }
  releaseDesktopBuild ??= invoke<boolean>("developer_mode")
    .then((developerBuild) => developerBuild === false)
    .catch(() => false);
  return releaseDesktopBuild;
}
