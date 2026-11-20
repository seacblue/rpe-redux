/**
 * Applies the user-facing window display settings at the desktop boundary.
 *
 * Tauri exposes fullscreen and window sizing for the WebView window, but not a
 * DXGI exclusive swap chain. The exclusive option therefore uses the same
 * borderless fullscreen path as the rest of this WebView-based application.
 *
 * Automatic sizing follows the display that holds most of the window: a launch
 * or a move between monitors keeps the same share of the screen instead of the
 * same physical rectangle. CSS pixels already follow the system DPI inside the
 * WebView, so the host only decides the window's logical size and never applies
 * a second scale factor to the interface.
 */
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { availableMonitors, getCurrentWindow, type Monitor } from "@tauri-apps/api/window";
import { isDesktop } from "../../../core/platform/environment.ts";

/** Window presentation supported by the settings surface. */
export type WindowDisplayMode = "windowed" | "fullscreen" | "exclusive";

/** Parsed logical window dimensions from a settings option. */
export interface WindowResolution {
  width: number;
  height: number;
}

/** A monitor's work area in physical pixels, with its DPI scale. */
export interface MonitorWorkArea {
  width: number;
  height: number;
  scaleFactor: number;
}

/** The share of the work area an automatic window keeps on either axis. */
const AUTOMATIC_FILL = 0.7;
/** The window's design ratio; the automatic size follows it. */
const WINDOW_ASPECT = 16 / 9;
/** Launch geometry never goes below the configured window minimum. */
const MIN_WINDOW_WIDTH = 1000;
const MIN_WINDOW_HEIGHT = 680;
/** How long a move must rest before the new display is adopted. */
const MONITOR_SETTLE_MS = 300;

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

/**
 * The window size an automatic launch uses on one display.
 *
 * The result is logical pixels (CSS pixels before the system DPI is applied),
 * keeps the 16:9 window ratio, and never drops below the configured minimum.
 */
export function automaticWindowSize(workArea: MonitorWorkArea): WindowResolution {
  const scale = workArea.scaleFactor > 0 ? workArea.scaleFactor : 1;
  const width = workArea.width / scale;
  const height = workArea.height / scale;
  const target = Math.min(width * AUTOMATIC_FILL, height * AUTOMATIC_FILL * WINDOW_ASPECT);
  return {
    width: Math.max(MIN_WINDOW_WIDTH, Math.round(target)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.round(target / WINDOW_ASPECT)),
  };
}

/** One monitor's work area in the shape the sizing rule reads. */
function monitorWorkArea(monitor: Monitor): MonitorWorkArea {
  return {
    width: monitor.workArea.size.width,
    height: monitor.workArea.size.height,
    scaleFactor: monitor.scaleFactor,
  };
}

/** The rectangular overlap of two physical screen rectangles. */
function overlapArea(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): number {
  const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * The display that holds the largest part of the window.
 *
 * Windows gives a window one DPI at a time, so a window straddling two displays
 * already paints at the dominant display's scale; choosing by overlap makes the
 * automatic size agree with the DPI the WebView reports instead of jumping to
 * whichever display merely contains a corner.
 */
async function dominantMonitor(): Promise<Monitor | null> {
  try {
    const window = getCurrentWindow();
    const [monitors, position, size] = await Promise.all([
      availableMonitors(),
      window.outerPosition(),
      window.outerSize(),
    ]);
    if (!monitors.length) {
      return null;
    }
    const rect = { x: position.x, y: position.y, width: size.width, height: size.height };
    let best = monitors[0];
    let bestArea = -1;
    for (const monitor of monitors) {
      const area = overlapArea(rect, {
        x: monitor.position.x,
        y: monitor.position.y,
        width: monitor.size.width,
        height: monitor.size.height,
      });
      if (area > bestArea) {
        best = monitor;
        bestArea = area;
      }
    }
    return best;
  } catch {
    // Monitor enumeration is an enhancement: a host that refuses it keeps the
    // ordinary fixed-size window instead of failing the launch.
    return null;
  }
}

/** A stable identity for the display that currently holds most of the window. */
export async function dominantMonitorSignature(): Promise<string> {
  if (!isDesktop()) {
    return "";
  }
  const monitor = await dominantMonitor();
  if (!monitor) {
    return "";
  }
  return [
    monitor.position.x,
    monitor.position.y,
    monitor.size.width,
    monitor.size.height,
    monitor.scaleFactor,
  ].join(":");
}

/** Keep a resized window inside the dominant display's work area. */
async function keepWindowOnMonitor(monitor: Monitor): Promise<void> {
  const window = getCurrentWindow();
  const [position, size] = await Promise.all([window.outerPosition(), window.outerSize()]);
  const area = monitor.workArea;
  const maxX = area.position.x + area.size.width - size.width;
  const maxY = area.position.y + area.size.height - size.height;
  const x = Math.min(Math.max(position.x, area.position.x), Math.max(area.position.x, maxX));
  const y = Math.min(Math.max(position.y, area.position.y), Math.max(area.position.y, maxY));
  if (x !== position.x || y !== position.y) {
    await window.setPosition(new PhysicalPosition(x, y));
  }
}

/**
 * Resize the window to the automatic share of its current display.
 *
 * A maximized or fullscreen window keeps the geometry the user chose; only a
 * restored window is fitted.
 */
export async function fitWindowToCurrentMonitor(): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  const window = getCurrentWindow();
  if (await window.isMaximized()) {
    return;
  }
  if (await window.isFullscreen()) {
    return;
  }
  const monitor = await dominantMonitor();
  if (!monitor) {
    return;
  }
  const size = automaticWindowSize(monitorWorkArea(monitor));
  await window.setSize(new LogicalSize(size.width, size.height));
  await keepWindowOnMonitor(monitor);
}

/**
 * Follow the display that holds most of the window.
 *
 * Moves fire continuously while the user drags, so the listener runs once the
 * gesture has rested; a window that is still straddling two displays keeps the
 * size it had until one display holds most of it.
 */
export function watchWindowMonitor(listener: () => void): () => void {
  if (!isDesktop()) {
    return () => {};
  }
  const window = getCurrentWindow();
  const stops: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let disposed = false;
  const schedule = () => {
    if (timer) {
      globalThis.clearTimeout(timer);
    }
    timer = globalThis.setTimeout(() => {
      timer = 0;
      if (!disposed) {
        listener();
      }
    }, MONITOR_SETTLE_MS);
  };
  const listen = (pending: Promise<() => void>) => {
    void pending.then((stop) => {
      if (disposed) {
        stop();
      } else {
        stops.push(stop);
      }
    });
  };
  listen(window.onMoved(schedule));
  listen(window.onScaleChanged(schedule));
  return () => {
    disposed = true;
    if (timer) {
      globalThis.clearTimeout(timer);
    }
    for (const stop of stops) {
      stop();
    }
  };
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
    if (resolution === "auto") {
      const monitor = await dominantMonitor();
      if (monitor) {
        const size = automaticWindowSize(monitorWorkArea(monitor));
        await window.setSize(new LogicalSize(size.width, size.height));
        await keepWindowOnMonitor(monitor);
      }
      return;
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
