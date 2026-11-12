/**
 * State behind the performance HUD.
 *
 * It owns the enabled preference, the stored position, the published snapshot and
 * snap edges, and the frame relay to the torn-off window.
 */
import { createValue, defineValue } from "../../../core/state/values.ts";
import { PREFERENCE_SECTIONS } from "../../../core/state/preferences.ts";
import { developerMode } from "../../../core/platform/desktop/developer.ts";
import type { MessageKey } from "../../../i18n/index.ts";
import { developerReveal, isDeveloperRevealed } from "../../../core/state/developerReveal.ts";
import {
  publishPerformanceHudFrame as publishPerformanceHudFrameToWindow,
  type PerformanceHudSnapEdges,
} from "../../../core/platform/desktop/performanceHudWindow.ts";

export const PERFORMANCE_HUD_ENABLED_ID = "settings.performance-hud-enabled";

/** Top-left position of the floating HUD, in window pixels. */
export interface PerformanceHudPosition {
  x: number;
  y: number;
}

export const performanceHudEnabled = defineValue<boolean>({
  id: PERFORMANCE_HUD_ENABLED_ID,
  initial: false,
  persist: PREFERENCE_SECTIONS.settings,
});

export const performanceHudPosition = defineValue<PerformanceHudPosition>({
  id: "performance-hud-position",
  initial: { x: 16, y: 96 },
  persist: PREFERENCE_SECTIONS.layout,
  validate(value) {
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || value.x < 0 || value.y < 0) {
      throw new Error("Performance HUD position must be a non-negative point");
    }
  },
});

/** Runtime flag for the torn-off window while it owns the monitor. */
const detachedHud = createValue<boolean>({ initial: false });
export const isPerformanceHudDetached = detachedHud.get;
export const subscribePerformanceHudDetached = detachedHud.subscribe;
export const setPerformanceHudDetached = detachedHud.set;

/** Whether the monitor is switched on, independent of developer mode. */
export function isPerformanceHudEnabled(): boolean {
  return performanceHudEnabled.get();
}

/** Whether the monitor is on and developer mode or its reveal makes it available. */
export function isPerformanceHudVisible(): boolean {
  // The monitor remains a developer surface: either the host build exposes the
  // developer tools, or the About-page reveal has opened that section. F3 itself
  // stays globally registered so the same key works on every surface.
  return (developerMode.get() || isDeveloperRevealed()) && isPerformanceHudEnabled();
}

/** Flips the monitor preference and returns the new value. */
export function togglePerformanceHud(): boolean {
  const next = !isPerformanceHudEnabled();
  performanceHudEnabled.set(next);
  return next;
}

/** One frame of measured values the HUD renders. */
export interface PerformanceHudSnapshot {
  fps: number;
  fpsSamples: readonly number[];
  drawTimeMs: number;
  frameTimesMs: readonly number[];
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

const snapshot = createValue<PerformanceHudSnapshot>({
  initial: {
    fps: 0,
    fpsSamples: [],
    drawTimeMs: 0,
    frameTimesMs: [],
    memoryAvailable: false,
    memoryUsedMb: 0,
    memoryLimitMb: 0,
    memorySamplesMb: [],
    renderLoadPercent: 0,
    renderLoadSamples: [],
    collaborationTrafficActive: false,
    collaborationUploadKbps: 0,
    collaborationDownloadKbps: 0,
    collaborationUploadSamples: [],
    collaborationDownloadSamples: [],
  },
});

export const getPerformanceHudSnapshot = snapshot.get;
export const subscribePerformanceHudSnapshot = snapshot.subscribe;
export const setPerformanceHudSnapshot = snapshot.set;

const snapEdges = createValue<PerformanceHudSnapEdges>({
  initial: { top: false, right: false, bottom: false, left: false },
});

export const getPerformanceHudSnapEdges = snapEdges.get;
export const subscribePerformanceHudSnapEdges = snapEdges.subscribe;
export const setPerformanceHudSnapEdges = snapEdges.set;

/** A readout row the HUD draws, either as text or as a sample bar. */
export type PerformanceHudBlock =
  | {
      id: string;
      label: MessageKey;
      kind: "text";
      value(snapshot: PerformanceHudSnapshot): string;
    }
  | {
      id: string;
      label: MessageKey;
      kind: "bar";
      values(snapshot: PerformanceHudSnapshot): readonly number[];
    };

const blocks = new Map<string, PerformanceHudBlock>();

/** Adds a HUD readout block; returns a disposer that removes it. */
export function registerPerformanceHudBlock(block: PerformanceHudBlock): () => void {
  if (blocks.has(block.id)) {
    throw new Error(`Performance HUD block already registered: ${block.id}`);
  }
  blocks.set(block.id, block);
  return () => {
    if (blocks.get(block.id) === block) {
      blocks.delete(block.id);
    }
  };
}

/** Returns the registered HUD blocks in registration order. */
export function getPerformanceHudBlocks(): readonly PerformanceHudBlock[] {
  return [...blocks.values()];
}

registerPerformanceHudBlock({
  id: "fps",
  label: "chrome.performanceHud.rafFps",
  kind: "text",
  value: (value) => value.fps.toFixed(1),
});
registerPerformanceHudBlock({
  id: "fps-graph",
  label: "chrome.performanceHud.fpsGraph",
  kind: "bar",
  values: (value) => value.fpsSamples,
});
registerPerformanceHudBlock({
  id: "draw-time",
  label: "chrome.performanceHud.drawTime",
  kind: "text",
  value: (value) => `${value.drawTimeMs.toFixed(1)} ms`,
});
registerPerformanceHudBlock({
  id: "memory",
  label: "chrome.performanceHud.memory",
  kind: "text",
  value: (value) =>
    value.memoryAvailable
      ? `${value.memoryUsedMb.toFixed(1)} / ${value.memoryLimitMb.toFixed(0)} MB`
      : "—",
});
registerPerformanceHudBlock({
  id: "cpu",
  label: "chrome.performanceHud.cpu",
  kind: "text",
  value: (value) => `${value.renderLoadPercent.toFixed(0)}%`,
});
let lastSnapshotAt = -Infinity;
const frameTimes: number[] = [];
const fpsSamples: number[] = [];
const memorySamplesMb: number[] = [];
const renderLoadSamples: number[] = [];
const collaborationUploadSamples: number[] = [];
const collaborationDownloadSamples: number[] = [];
let collaborationTrafficActive = false;
let collaborationTrafficSampleStartedAt = -Infinity;
let collaborationUploadBytes = 0;
let collaborationDownloadBytes = 0;
let collaborationUploadKbps = 0;
let collaborationDownloadKbps = 0;

const COLLABORATION_TRAFFIC_SAMPLE_MS = 500;

/** Clears the rolling traffic series when a room connection starts or ends. */
export function setPerformanceHudCollaborationTrafficActive(active: boolean): void {
  if (collaborationTrafficActive === active) {
    return;
  }
  collaborationTrafficActive = active;
  collaborationTrafficSampleStartedAt = -Infinity;
  collaborationUploadBytes = 0;
  collaborationDownloadBytes = 0;
  collaborationUploadKbps = 0;
  collaborationDownloadKbps = 0;
  collaborationUploadSamples.length = 0;
  collaborationDownloadSamples.length = 0;
  snapshot.update({
    collaborationTrafficActive: active,
    collaborationUploadKbps: 0,
    collaborationDownloadKbps: 0,
    collaborationUploadSamples: [],
    collaborationDownloadSamples: [],
  });
}

/** Adds one successfully sent or received room frame to the rolling series. */
export function recordPerformanceHudTraffic(direction: "upload" | "download", bytes: number): void {
  if (!collaborationTrafficActive || !Number.isFinite(bytes) || bytes <= 0) {
    return;
  }
  if (direction === "upload") {
    collaborationUploadBytes += bytes;
  } else {
    collaborationDownloadBytes += bytes;
  }
}

/** Finalizes elapsed traffic windows and converts them to kilobytes per second. */
function publishCollaborationTraffic(timestamp: number): void {
  if (!collaborationTrafficActive) {
    return;
  }
  if (!Number.isFinite(collaborationTrafficSampleStartedAt)) {
    collaborationTrafficSampleStartedAt = timestamp;
    return;
  }
  const elapsed = timestamp - collaborationTrafficSampleStartedAt;
  if (elapsed < COLLABORATION_TRAFFIC_SAMPLE_MS) {
    return;
  }
  const scale = 1000 / elapsed / 1024;
  collaborationUploadKbps = collaborationUploadBytes * scale;
  collaborationDownloadKbps = collaborationDownloadBytes * scale;
  appendSample(collaborationUploadSamples, collaborationUploadKbps);
  appendSample(collaborationDownloadSamples, collaborationDownloadKbps);
  collaborationUploadBytes = 0;
  collaborationDownloadBytes = 0;
  collaborationTrafficSampleStartedAt = timestamp;
}

/** Heap figures the WebView exposes through `performance.memory`. */
interface PerformanceMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

/** Appends one sample, keeping the newest 60. */
function appendSample(samples: number[], value: number): void {
  samples.push(value);
  if (samples.length > 60) {
    samples.shift();
  }
}

/** Reads the WebView heap figures, reporting unavailability rather than guessing. */
function readMemory(): {
  available: boolean;
  usedMb: number;
  limitMb: number;
} {
  const memory = (globalThis.performance as Performance & { memory?: PerformanceMemory }).memory;
  if (
    !memory ||
    !Number.isFinite(memory.usedJSHeapSize) ||
    !Number.isFinite(memory.jsHeapSizeLimit) ||
    memory.jsHeapSizeLimit <= 0
  ) {
    return { available: false, usedMb: 0, limitMb: 0 };
  }
  const megabyte = 1024 * 1024;
  return {
    available: true,
    usedMb: memory.usedJSHeapSize / megabyte,
    limitMb: memory.jsHeapSizeLimit / megabyte,
  };
}

/**
 * Records one frame's measurements, throttles snapshot publication to about
 * 15 Hz, and relays the snapshot to a torn-off window.
 */
export function publishPerformanceHudFrame({
  timestamp,
  fps,
  drawTimeMs,
}: {
  timestamp: number;
  fps: number;
  drawTimeMs: number;
}): void {
  if (!isPerformanceHudVisible()) {
    return;
  }
  frameTimes.push(drawTimeMs);
  if (frameTimes.length > 60) {
    frameTimes.shift();
  }
  appendSample(fpsSamples, Math.max(0, fps));
  const memory = readMemory();
  appendSample(memorySamplesMb, memory.usedMb);
  // Render load is the share of the 60 FPS frame budget consumed by draw time.
  const renderLoadPercent = Math.min(100, Math.max(0, (drawTimeMs / (1000 / 60)) * 100));
  appendSample(renderLoadSamples, renderLoadPercent);
  publishCollaborationTraffic(timestamp);
  if (timestamp - lastSnapshotAt < 1000 / 15) {
    return;
  }
  lastSnapshotAt = timestamp;
  snapshot.set({
    fps,
    fpsSamples: [...fpsSamples],
    drawTimeMs,
    frameTimesMs: [...frameTimes],
    memoryAvailable: memory.available,
    memoryUsedMb: memory.usedMb,
    memoryLimitMb: memory.limitMb,
    memorySamplesMb: [...memorySamplesMb],
    renderLoadPercent,
    renderLoadSamples: [...renderLoadSamples],
    collaborationTrafficActive,
    collaborationUploadKbps,
    collaborationDownloadKbps,
    collaborationUploadSamples: [...collaborationUploadSamples],
    collaborationDownloadSamples: [...collaborationDownloadSamples],
  });
  void publishPerformanceHudFrameToWindow(snapshot.get()).catch(() => {});
}

/** Stores the HUD position, clamping both axes to non-negative values. */
export function setPerformanceHudPosition(position: PerformanceHudPosition): void {
  performanceHudPosition.set({
    x: Math.max(0, position.x),
    y: Math.max(0, position.y),
  });
}

/** Subscribes to every store that can change HUD visibility; returns the unsubscribe. */
export function subscribePerformanceHudVisibility(listener: () => void): () => void {
  const unsubscribeEnabled = performanceHudEnabled.subscribe(listener);
  const unsubscribeDeveloper = developerMode.subscribe(listener);
  const unsubscribeReveal = developerReveal.subscribe(listener);
  return () => {
    unsubscribeEnabled();
    unsubscribeDeveloper();
    unsubscribeReveal();
  };
}
