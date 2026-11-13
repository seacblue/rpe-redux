/**
 * The detached performance-HUD window.
 *
 * Creates and shows the window, relays frame payloads, and tracks dock and snap
 * state. The labels and event names here are the contract with the Rust host.
 */
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Window label and event names the Rust host and the HUD share. */
export const PERFORMANCE_HUD_WINDOW_LABEL = "performance-hud";
/** Frame readings published from the main window. */
export const PERFORMANCE_HUD_FRAME_EVENT = "performance-hud-frame";
/** Announcement that the HUD docked back into the main window. */
export const PERFORMANCE_HUD_DOCK_EVENT = "performance-hud-dock";
/** Snap-edge state published by the detached HUD. */
export const PERFORMANCE_HUD_SNAP_EVENT = "performance-hud-snap";

/** One frame's timing and memory readings sent to the HUD window. */
export interface PerformanceHudFramePayload {
  fps: number;
  fpsSamples: readonly number[];
  drawTimeMs: number;
  frameTimesMs: readonly number[];
  frameIntervalMs: number;
  frameBudgetMs: number;
  targetRefreshRate: number;
  frameIntervalLoadPercent: number;
  frameIntervalLoadSamples: readonly number[];
  timelineDrawMs: number;
  timelineDrawSamples: readonly number[];
  previewDrawMs: number;
  previewDrawSamples: readonly number[];
  memoryAvailable: boolean;
  memoryUsedMb: number;
  memoryLimitMb: number;
  memorySamplesMb: readonly number[];
  renderLoadPercent: number;
  renderLoadSamples: readonly number[];
  collaborationTrafficActive: boolean;
  collaborationUploadKbps: number;
  collaborationDownloadKbps: number;
  collaborationUploadSamples: readonly number[];
  collaborationDownloadSamples: readonly number[];
}

/** Screen edges the detached HUD snapped to. */
export interface PerformanceHudSnapEdges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

/** Native window state for the detached HUD at a proposed position. */
export interface PerformanceHudWindowState {
  shouldRedock: boolean;
  snapEdges: PerformanceHudSnapEdges;
}

interface PerformanceHudPoint {
  x: number;
  y: number;
}

/** Whether this webview is the detached performance-HUD window. */
export function isPerformanceHudWindow(): boolean {
  return new URLSearchParams(window.location.search).get("window") === PERFORMANCE_HUD_WINDOW_LABEL;
}

/** Open the detached HUD at a document-relative point converted to screen coordinates. */
export async function tearOffPerformanceHud(position: { x: number; y: number }): Promise<void> {
  const currentWindow = getCurrentWindow();
  const [outerPosition, scaleFactor] = await Promise.all([
    currentWindow.outerPosition(),
    currentWindow.scaleFactor(),
  ]);
  await invoke("open_performance_hud_window", {
    x: Math.round(outerPosition.x + position.x * scaleFactor),
    y: Math.round(outerPosition.y + position.y * scaleFactor),
  });
}

/** Close the detached HUD window through the host command. */
export async function closeTornOffPerformanceHud(): Promise<void> {
  await invoke("close_performance_hud_window");
}

/** Ask the host whether the HUD should redock and which edges it snapped to. */
export async function inspectTornOffPerformanceHud(
  position: PerformanceHudPoint,
): Promise<PerformanceHudWindowState> {
  return invoke<PerformanceHudWindowState>("performance_hud_window_state", {
    x: position.x,
    y: position.y,
  });
}

/** Begin a native window drag from the HUD's drag handle. */
export async function startTornOffPerformanceHudDrag(): Promise<void> {
  await getCurrentWindow().startDragging();
}

/** Observe native HUD moves; the returned function stops listening. */
export async function listenForTornOffPerformanceHudMove(
  listener: (position: PerformanceHudPoint) => void,
): Promise<UnlistenFn> {
  return getCurrentWindow().onMoved(({ payload }) => listener(payload));
}

/** Observe close requests for the detached HUD before the window closes. */
export async function listenForTornOffPerformanceHudClose(
  listener: () => void,
): Promise<UnlistenFn> {
  return getCurrentWindow().onCloseRequested(() => listener());
}

/** Broadcast one frame's readings to the HUD window. */
export async function publishPerformanceHudFrame(
  payload: PerformanceHudFramePayload,
): Promise<void> {
  await emit(PERFORMANCE_HUD_FRAME_EVENT, payload);
}

/** Receive frame readings in the detached HUD; the returned function unlistens. */
export async function listenForPerformanceHudFrames(
  listener: (payload: PerformanceHudFramePayload) => void,
): Promise<UnlistenFn> {
  return listen<PerformanceHudFramePayload>(PERFORMANCE_HUD_FRAME_EVENT, ({ payload }) =>
    listener(payload),
  );
}

/** Broadcast the edges the HUD window snapped to. */
export async function publishPerformanceHudSnapEdges(
  payload: PerformanceHudSnapEdges,
): Promise<void> {
  await emit(PERFORMANCE_HUD_SNAP_EVENT, payload);
}

/** Receive snap-edge updates in the detached HUD. */
export async function listenForPerformanceHudSnapEdges(
  listener: (payload: PerformanceHudSnapEdges) => void,
): Promise<UnlistenFn> {
  return listen<PerformanceHudSnapEdges>(PERFORMANCE_HUD_SNAP_EVENT, ({ payload }) =>
    listener(payload),
  );
}

/** Tell the main window that the HUD has docked. */
export async function announcePerformanceHudDock(): Promise<void> {
  await emit(PERFORMANCE_HUD_DOCK_EVENT);
}

/** Receive the HUD dock announcement in the main window. */
export async function listenForPerformanceHudDock(listener: () => void): Promise<UnlistenFn> {
  return listen(PERFORMANCE_HUD_DOCK_EVENT, listener);
}
