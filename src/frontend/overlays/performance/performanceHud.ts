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
  type PerformanceHudFramePayload,
  type PerformanceHudSnapEdges,
} from "../../../core/platform/desktop/performanceHudWindow.ts";
import {
  appendBoundedSample,
  frameBudgetMs,
  frameIntervalLoadPercent,
  renderLoadPercent,
} from "./performanceHudMetrics.ts";
import { performanceFrameTimingSnapshot } from "./performanceFrameTiming.ts";
import { lastRenderTiming } from "../../../core/diagnostics/renderMetrics.ts";

export const PERFORMANCE_HUD_ENABLED_ID = "settings.performance-hud-enabled";

/** Top-left position of the floating HUD, in window pixels. */
export interface PerformanceHudPosition {
  x: number;
  y: number;
}

/** User-adjusted size of the floating performance HUD. Height zero keeps the automatic height. */
export interface PerformanceHudSize {
  width: number;
  height: number;
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

export const performanceHudSize = defineValue<PerformanceHudSize>({
  id: "performance-hud-size",
  initial: { width: 760, height: 0 },
  persist: PREFERENCE_SECTIONS.layout,
  validate(value) {
    if (
      !Number.isFinite(value.width) ||
      !Number.isFinite(value.height) ||
      value.width <= 0 ||
      value.height < 0
    ) {
      throw new Error("Performance HUD size must be a positive width and non-negative height");
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

/**
 * One frame of measured values the HUD renders.
 *
 * The docked HUD and the detached window render the same readings, so this is
 * the relay payload rather than a second declaration of its fields.
 */
export type PerformanceHudSnapshot = PerformanceHudFramePayload;

const snapshot = createValue<PerformanceHudSnapshot>({
  initial: {
    fps: 0,
    paintFps: 0,
    fpsSamples: [],
    drawTimeMs: 0,
    frameTimesMs: [],
    frameIntervalMs: 0,
    frameBudgetMs: 1000 / 60,
    targetRefreshRate: 60,
    frameIntervalLoadPercent: 0,
    frameIntervalLoadSamples: [],
    drawTimeSamples: [],
    timelineDrawSamples: [],
    previewDrawSamples: [],
    selectionSamples: [],
    timelineDrawMs: 0,
    previewDrawMs: 0,
    selectionMs: 0,
    previewLineDrawMs: 0,
    previewNoteDrawMs: 0,
    previewEffectsMs: 0,
    previewCompositeMs: 0,
    previewSampleMs: 0,
    previewVisibilityMs: 0,
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

/** A compact signal the HUD draws as text, a graph, or a sample bar. */
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
      kind: "history-graph";
      series: readonly PerformanceHudSeries[];
      maximum?(snapshot: PerformanceHudSnapshot): number;
      secondaryCurrent?(snapshot: PerformanceHudSnapshot): string;
    }
  | {
      id: string;
      label: MessageKey;
      kind: "hotspot-graph";
    }
  | {
      id: string;
      label: MessageKey;
      kind: "bar";
      values(snapshot: PerformanceHudSnapshot): readonly number[];
    };

/** One labelled line in a retained history graph. */
export interface PerformanceHudSeries {
  id: string;
  label: MessageKey;
  color: "accent" | "warning" | "preview" | "memory";
  unit: "FPS" | "ms" | "%" | "MB";
  values(snapshot: PerformanceHudSnapshot): readonly number[];
}

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
  kind: "history-graph",
  series: [
    {
      id: "fps",
      label: "chrome.performanceHud.rafFps",
      color: "accent",
      unit: "FPS",
      values: (value) => value.fpsSamples,
    },
  ],
  secondaryCurrent: (value) => `${value.frameIntervalMs.toFixed(1)} ms`,
});
registerPerformanceHudBlock({
  id: "hotspots",
  label: "chrome.performanceHud.hotspots",
  kind: "hotspot-graph",
});
registerPerformanceHudBlock({
  id: "cpu",
  label: "chrome.performanceHud.cpu",
  kind: "history-graph",
  series: [
    {
      id: "cpu",
      label: "chrome.performanceHud.cpu",
      color: "warning",
      unit: "%",
      values: (value) => value.renderLoadSamples,
    },
  ],
  maximum: () => 100,
});
registerPerformanceHudBlock({
  id: "memory",
  label: "chrome.performanceHud.memory",
  kind: "history-graph",
  series: [
    {
      id: "memory",
      label: "chrome.performanceHud.memory",
      color: "memory",
      unit: "MB",
      values: (value) => value.memorySamplesMb,
    },
  ],
});
let lastSnapshotAt = -Infinity;
const frameIntervals: number[] = [];
const fpsSamples: number[] = [];
const frameIntervalLoadSamples: number[] = [];
const memorySamplesMb: number[] = [];
const renderLoadSamples: number[] = [];
const drawTimeSamples: number[] = [];
const timelineDrawSamples: number[] = [];
const previewDrawSamples: number[] = [];
const selectionSamples: number[] = [];
let lastFrameTimestamp = Number.NaN;
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
  appendBoundedSample(collaborationUploadSamples, collaborationUploadKbps);
  appendBoundedSample(collaborationDownloadSamples, collaborationDownloadKbps);
  collaborationUploadBytes = 0;
  collaborationDownloadBytes = 0;
  collaborationTrafficSampleStartedAt = timestamp;
}

/** Heap figures the WebView exposes through `performance.memory`. */
interface PerformanceMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
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
  paintFps,
  drawTimeMs,
  targetRefreshRate,
}: {
  timestamp: number;
  fps: number;
  paintFps: number;
  drawTimeMs: number;
  targetRefreshRate: number;
}): void {
  if (!isPerformanceHudVisible()) {
    lastFrameTimestamp = Number.NaN;
    return;
  }
  const hasPreviousFrame = Number.isFinite(lastFrameTimestamp);
  const frameIntervalMs = hasPreviousFrame ? Math.max(0, timestamp - lastFrameTimestamp) : 0;
  lastFrameTimestamp = timestamp;
  if (hasPreviousFrame) {
    appendBoundedSample(frameIntervals, frameIntervalMs);
  }
  appendBoundedSample(fpsSamples, Math.max(0, fps));
  const memory = readMemory();
  appendBoundedSample(memorySamplesMb, memory.usedMb);
  const safeTargetRefreshRate =
    Number.isFinite(targetRefreshRate) && targetRefreshRate > 0 ? targetRefreshRate : 60;
  const targetFrameBudgetMs = frameBudgetMs(safeTargetRefreshRate);
  const renderLoad = renderLoadPercent(drawTimeMs, safeTargetRefreshRate);
  const intervalLoad = frameIntervalLoadPercent(frameIntervalMs, safeTargetRefreshRate);
  const paintTiming = performanceFrameTimingSnapshot();
  const previewTiming = lastRenderTiming();
  const timelineDrawMs = Math.max(0, paintTiming.timelineMs);
  const previewDrawMs = Math.max(0, paintTiming.previewMs);
  const selectionMs = Math.max(0, paintTiming.selectionMs ?? 0);
  appendBoundedSample(drawTimeSamples, Math.max(0, drawTimeMs));
  appendBoundedSample(timelineDrawSamples, timelineDrawMs);
  appendBoundedSample(previewDrawSamples, previewDrawMs);
  appendBoundedSample(selectionSamples, selectionMs);
  // Keep over-budget values visible: 11 ms at 144 Hz is 158% of the budget.
  const renderLoadPercentValue = Math.max(0, renderLoad);
  const frameIntervalLoadValue = hasPreviousFrame ? Math.max(0, intervalLoad) : 0;
  appendBoundedSample(renderLoadSamples, renderLoadPercentValue);
  appendBoundedSample(frameIntervalLoadSamples, frameIntervalLoadValue);
  publishCollaborationTraffic(timestamp);
  if (timestamp - lastSnapshotAt < 1000 / 15) {
    return;
  }
  lastSnapshotAt = timestamp;
  snapshot.set({
    fps,
    paintFps,
    fpsSamples: [...fpsSamples],
    drawTimeMs,
    frameTimesMs: [...frameIntervals],
    frameIntervalMs,
    frameBudgetMs: targetFrameBudgetMs,
    targetRefreshRate: safeTargetRefreshRate,
    frameIntervalLoadPercent: frameIntervalLoadValue,
    frameIntervalLoadSamples: [...frameIntervalLoadSamples],
    drawTimeSamples: [...drawTimeSamples],
    timelineDrawSamples: [...timelineDrawSamples],
    previewDrawSamples: [...previewDrawSamples],
    selectionSamples: [...selectionSamples],
    timelineDrawMs,
    previewDrawMs,
    selectionMs,
    previewLineDrawMs: previewTiming?.lineDrawMs ?? 0,
    previewNoteDrawMs: previewTiming?.noteDrawMs ?? 0,
    previewEffectsMs: previewTiming?.effectsMs ?? 0,
    previewCompositeMs: previewTiming?.compositeMs ?? 0,
    previewSampleMs: previewTiming?.sampleMs ?? 0,
    previewVisibilityMs: previewTiming?.visibilityMs ?? 0,
    memoryAvailable: memory.available,
    memoryUsedMb: memory.usedMb,
    memoryLimitMb: memory.limitMb,
    memorySamplesMb: [...memorySamplesMb],
    renderLoadPercent: renderLoadPercentValue,
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

/** Persists a user-resized HUD while keeping dimensions finite and usable. */
export function setPerformanceHudSize(size: PerformanceHudSize): void {
  performanceHudSize.set({
    width: Math.max(1, size.width),
    height: Math.max(0, size.height),
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
