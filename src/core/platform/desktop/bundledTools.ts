/**
 * Optional third-party tools a desktop build carries.
 *
 * A local build can be made without the FFmpeg encoder and the Cloudflare
 * Tunnel client. The surfaces that need one ask here once, then fall back with a
 * warning instead of failing after the user has already chosen an output file.
 */
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../environment.ts";

/** Availability of the tools a build may omit. */
export interface BundledToolStatus {
  readonly encoder: boolean;
  readonly tunnel: boolean;
}

/**
 * Reported when the host cannot answer.
 *
 * Both tools are assumed present so a failed probe never disables a feature that
 * would otherwise work; the feature's own error path stays authoritative.
 */
const ASSUMED_AVAILABLE: BundledToolStatus = Object.freeze({ encoder: true, tunnel: true });

let pending: Promise<BundledToolStatus> | null = null;

/**
 * Resolve the host's tool availability once per session.
 *
 * The answer describes which binaries the installation carries, so it cannot
 * change while the application runs; the resolved promise is reused.
 */
export function bundledToolStatus(): Promise<BundledToolStatus> {
  if (!isDesktop()) {
    return Promise.resolve(ASSUMED_AVAILABLE);
  }
  pending ??= invoke<BundledToolStatus>("bundled_tool_status").catch(() => ASSUMED_AVAILABLE);
  return pending;
}
