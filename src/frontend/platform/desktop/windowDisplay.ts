/**
 * Applies the user-facing window display settings at the desktop boundary.
 *
 * Tauri exposes fullscreen and window sizing for the WebView window, but not a
 * DXGI exclusive swap chain. The exclusive option therefore uses the same
 * borderless fullscreen path as the rest of this WebView-based application.
 */
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktop } from "../../../core/platform/environment.ts";

/** Window presentation supported by the settings surface. */
export type WindowDisplayMode = "windowed" | "fullscreen" | "exclusive";

/** Parsed logical window dimensions from a settings option. */
export interface WindowResolution {
  width: number;
  height: number;
}

/** Parse one `widthxheight` option, or return null for automatic sizing. */
export function parseWindowResolution(value: string): WindowResolution | null {
  const match = /^(\d+)x(\d+)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Applies the mode and windowed size selected in General → Interface. */
export async function applyWindowDisplaySettings(
  mode: WindowDisplayMode,
  resolution: string,
): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  const window = getCurrentWindow();
  await window.setDecorations(false);
  if (mode === "windowed") {
    await window.setFullscreen(false);
    if (await window.isMaximized()) {
      await window.unmaximize();
    }
    const size = parseWindowResolution(resolution);
    if (size) {
      await window.setSize(new LogicalSize(size.width, size.height));
    }
    return;
  }
  // Tauri's fullscreen flag is a borderless, compositor-managed fullscreen
  // window. WebView2 does not expose the swap-chain control needed for true
  // exclusive display-mode changes, so both fullscreen choices remain safe and
  // reversible on Windows and other supported desktop hosts.
  await window.setFullscreen(true);
}

/** Shows the native window after startup geometry and display mode are ready. */
export async function showDesktopWindow(): Promise<void> {
  if (isDesktop()) {
    await getCurrentWindow().show();
  }
}
