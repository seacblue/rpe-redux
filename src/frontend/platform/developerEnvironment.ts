/**
 * Collects the runtime facts shown on the developer settings page.
 *
 * The browser owns the WebView, GPU, and system facts; the desktop host owns
 * the Tauri version and the durable data directory. Every probe is best-effort
 * and returns null when the host cannot answer, so the settings list always
 * renders with a stable shape.
 */
import { getTauriVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { appVersion } from "../../core/platform/appInfo.ts";
import { BUILD_APP_VERSION } from "../../core/platform/buildInfo.ts";
import { isDesktop } from "../../core/platform/environment.ts";
import { isPrereleaseVersion } from "../../core/utils/version.ts";

/** The build channel derived from the version and the running bundle. */
export type DeveloperChannel = "stable" | "beta" | "development";

/** Facts that describe the running build and the host behind it. */
export interface DeveloperEnvironment {
  readonly version: string;
  readonly channel: DeveloperChannel;
  readonly tauri: string | null;
  readonly webview: string | null;
  readonly chromium: string | null;
  readonly system: string;
  readonly gpu: string | null;
  readonly dataDirectory: string | null;
}

/** The portion of a user agent that names a version. */
function userAgentVersion(pattern: RegExp, userAgent: string): string | null {
  const match = pattern.exec(userAgent);
  return match?.[1] ?? null;
}

/** WebView2 runtime version from the Edge token, or null outside WebView2. */
export function webViewVersion(userAgent = globalThis.navigator?.userAgent ?? ""): string | null {
  return userAgentVersion(/\bEdg\/([\d.]+)/i, userAgent);
}

/** Chromium version from the Chrome token, or null when the agent omits it. */
export function chromiumVersion(userAgent = globalThis.navigator?.userAgent ?? ""): string | null {
  return userAgentVersion(/\bChrome\/([\d.]+)/i, userAgent);
}

/** A readable Windows version for the NT build families that reach WebView2. */
function windowsName(version: string): string {
  if (version === "10.0") {
    return "Windows 10/11";
  }
  if (version === "6.3") {
    return "Windows 8.1";
  }
  if (version === "6.2") {
    return "Windows 8";
  }
  if (version === "6.1") {
    return "Windows 7";
  }
  return `Windows NT ${version}`;
}

/**
 * A readable operating system and CPU architecture from the user agent.
 *
 * WebView2 reports `Windows NT 10.0` for both Windows 10 and 11, so the shared
 * label names both rather than guessing from the build number.
 */
export function describeSystem(userAgent = globalThis.navigator?.userAgent ?? ""): string {
  const architecture = /\bWOW64\b/i.test(userAgent)
    ? "x86"
    : /\bARM64\b|\baarch64\b/i.test(userAgent)
      ? "ARM64"
      : /\bWin64\b|\bx86_64\b|\bx64\b|\bIntel Mac\b/i.test(userAgent)
        ? "x64"
        : "x86";
  const windows = /\bWindows NT ([\d.]+)/i.exec(userAgent);
  if (windows) {
    return `${windowsName(windows[1])} · ${architecture}`;
  }
  const mac = /\bMac OS X ([\d_]+)/i.exec(userAgent);
  if (mac) {
    return `macOS ${mac[1].replaceAll("_", ".")} · ${architecture}`;
  }
  if (/\bAndroid\b/i.test(userAgent)) {
    return `Android · ${architecture}`;
  }
  if (/\bLinux\b/i.test(userAgent)) {
    return `Linux · ${architecture}`;
  }
  return "Unknown";
}

/** The WebGL vendor and renderer, or null when no context can be created. */
export function describeGpu(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl) {
    return null;
  }
  try {
    const debug = gl.getExtension("WEBGL_debug_renderer_info") as {
      readonly UNMASKED_VENDOR_WEBGL: number;
      readonly UNMASKED_RENDERER_WEBGL: number;
    } | null;
    const vendor = gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR);
    const renderer = gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
    const parts = [vendor, renderer]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());
    return parts.length > 0 ? parts.join(" · ") : null;
  } catch {
    return null;
  } finally {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

/** Read the desktop data directory, or null in a browser build. */
async function readDataDirectory(): Promise<string | null> {
  if (!isDesktop()) {
    return null;
  }
  try {
    const path = await invoke<string>("app_data_dir");
    return typeof path === "string" && path.trim() ? path : null;
  } catch {
    return null;
  }
}

/** Read the application version, resolving the host's answer when possible. */
async function readVersion(): Promise<string> {
  try {
    return await appVersion();
  } catch {
    return BUILD_APP_VERSION;
  }
}

/** Read every runtime fact in parallel for one settings-page snapshot. */
export async function readDeveloperEnvironment(): Promise<DeveloperEnvironment> {
  const [version, tauri, dataDirectory] = await Promise.all([
    readVersion(),
    isDesktop() ? getTauriVersion().catch(() => null) : Promise.resolve<string | null>(null),
    readDataDirectory(),
  ]);
  const channel: DeveloperChannel = isPrereleaseVersion(version)
    ? "beta"
    : import.meta.env?.DEV
      ? "development"
      : "stable";
  return {
    version,
    channel,
    tauri: tauri && tauri.trim() ? tauri : null,
    webview: webViewVersion(),
    chromium: chromiumVersion(),
    system: describeSystem(),
    gpu: describeGpu(),
    dataDirectory,
  };
}

let cachedEnvironment: Promise<DeveloperEnvironment> | null = null;

/** Read the environment once per page session; callers share the same probe. */
export function loadDeveloperEnvironment(): Promise<DeveloperEnvironment> {
  cachedEnvironment ??= readDeveloperEnvironment();
  return cachedEnvironment;
}
