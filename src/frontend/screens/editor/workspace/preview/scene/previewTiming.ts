/** Collects per-frame preview timings and forwards them to an attached probe. */

import { recordPreviewTiming } from "../../../../../../core/diagnostics/renderMetrics.ts";
import type { RenderPath } from "../../../../../../core/diagnostics/renderMetrics.ts";

/** One frame's timing breakdown, draw counts, and active rendering paths. */
export interface PreviewTimingSample {
  /** Chart time represented by this painted frame. */
  seconds: number;
  totalMs: number;
  /** Time spent rebuilding the retained scene after a chart identity change. */
  sceneCompileMs: number;
  /** Time spent refreshing note-derived preview collections after a chart change. */
  sceneCollectionsMs: number;
  /** Time spent feeding the chart into the shader effect runtime. */
  shaderCompileMs: number;
  /** Time spent preparing shader programs for the current effect set. */
  shaderPrewarmMs: number;
  /** Time spent preparing the clipped Canvas frame and background. */
  canvasPrepareMs: number;
  setupMs: number;
  sampleMs: number;
  visibilityMs: number;
  visibilityIndexMs: number;
  visibilityCandidateCount: number;
  notesMs: number;
  effectsMs: number;
  compositeMs: number;
  /** CPU time spent copying the Canvas2D source into the shader texture. */
  shaderSourceUploadMs: number;
  /** CPU time spent copying a legacy overlay canvas into the shader texture. */
  shaderOverlayUploadMs: number;
  visibleNoteCount: number;
  visibleHoldCount: number;
  lineCount: number;
  drawnLineCount: number;
  drawnNoteCount: number;
  drawnHoldCount: number;
  batchFallbackCount: number;
  fallbackReasons: Record<string, number>;
  lineDrawMs: number;
  noteDrawMs: number;
  collectGeometry: boolean;
  noteBatchActive: boolean;
  renderPath: RenderPath;
  sampledLineCount?: number;
  staticLineCacheHits?: number;
  continuousLineCount?: number;
  parentComposeCount?: number;
  stateCopyCount?: number;
  eventCursorHits?: number;
  eventCursorMisses?: number;
  guideDrawMs?: number;
  guideGroupCount?: number;
  guideVisibleGroupCount?: number;
  guideTextCacheHits?: number;
  guideTextCacheMisses?: number;
  guideDrawCalls?: number;
  guideRenderPath?: "webgl_atlas" | "canvas_atlas" | "canvas_fallback";
}

/** Receives one sample per painted preview frame. */
export interface PreviewTimingProbe {
  (sample: PreviewTimingSample): void;
}

/** Sends a sample to the performance harness when one is attached. */
export function reportPreviewTiming(sample: PreviewTimingSample): void {
  recordPreviewTiming(sample);
  const probe = (
    globalThis as typeof globalThis & { __reduxPreviewTimingProbe?: PreviewTimingProbe }
  ).__reduxPreviewTimingProbe;
  probe?.(sample);
}
