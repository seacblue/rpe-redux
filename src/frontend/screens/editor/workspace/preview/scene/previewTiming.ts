/** Collects per-frame preview timings and forwards them to an attached probe. */

import { recordPreviewTiming } from "../../../../../../core/diagnostics/renderMetrics.ts";
import type { RenderPath } from "../../../../../../core/diagnostics/renderMetrics.ts";

/** One frame's timing breakdown, draw counts, and active rendering paths. */
export interface PreviewTimingSample {
  totalMs: number;
  setupMs: number;
  sampleMs: number;
  visibilityMs: number;
  visibilityIndexMs: number;
  visibilityCandidateCount: number;
  notesMs: number;
  effectsMs: number;
  compositeMs: number;
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
