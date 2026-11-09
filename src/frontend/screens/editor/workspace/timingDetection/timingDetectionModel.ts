/**
 * Pure view and apply rules for the fixed-BPM timing detector.
 *
 * The detector reports one measured BPM/offset pair, or no pair at all. This
 * module formats that answer, parses the two editable fields, scales the tempo,
 * shifts the offset by whole beats, and builds the fixed timing chart the host
 * commits. Keeping those rules here lets the React surfaces stay thin and makes
 * the behaviour testable without a DOM.
 */
import type { Chart } from "../../../../../core/global/chart/chart.ts";
import { chartWithDetectedTiming } from "../../../../../core/global/chart/editing/drafts.ts";
import { roundMeasuredTiming } from "../../../../../core/media/beatDetection.ts";

/** The action that applies a fixed BPM to the current chart. */
export type TimingApplyLabelKey =
  "editorPanels.timingDetection.apply" | "editorPanels.timingDetection.replaceAndApply";

/** One validated BPM/offset pair from the dialog fields. */
export interface TimingDraft {
  bpm: number;
  offsetMs: number;
}

/** Parse the editable BPM and offset, or null when either is unusable. */
export function parseTimingDraft(bpm: string, offset: string): TimingDraft | null {
  if (bpm.trim() === "" || offset.trim() === "") {
    return null;
  }
  const nextBpm = Number(bpm);
  const nextOffset = Number(offset);
  if (!(nextBpm > 0) || !Number.isFinite(nextBpm) || !Number.isFinite(nextOffset)) {
    return null;
  }
  return { bpm: nextBpm, offsetMs: nextOffset };
}

/**
 * Scale a measured BPM by a positive factor such as 2 or 0.5.
 *
 * The result keeps the detector's three-decimal precision. Returns `null` when
 * either input cannot produce a usable positive tempo.
 */
export function scaleMeasuredBpm(bpm: number, factor: number): number | null {
  if (!Number.isFinite(bpm) || !Number.isFinite(factor) || !(bpm > 0) || !(factor > 0)) {
    return null;
  }
  return roundMeasuredTiming(bpm * factor);
}

/**
 * Shift an offset by whole beats at the given BPM.
 *
 * The result keeps the detector's three-decimal precision and snaps to a whole
 * millisecond when it lands within the measurement threshold of one. Returns
 * `null` when the current BPM cannot define a beat.
 */
export function shiftOffsetByBeats(offsetMs: number, bpm: number, beats: number): number | null {
  if (!Number.isFinite(offsetMs) || !Number.isFinite(beats) || !(bpm > 0)) {
    return null;
  }
  return roundMeasuredTiming(offsetMs + (beats * 60000) / bpm);
}

/** The chart and seek time produced by applying the fixed timing. */
export interface TimingApplication {
  chart: Chart;
  seekMs: number;
}

/** Build the fixed-BPM chart; null when the editable fields are invalid. */
export function applyDetectedTiming(
  chart: Chart,
  bpm: string,
  offset: string,
): TimingApplication | null {
  const draft = parseTimingDraft(bpm, offset);
  if (!draft) {
    return null;
  }
  return {
    chart: chartWithDetectedTiming(chart, draft.bpm, draft.offsetMs),
    seekMs: draft.offsetMs,
  };
}

/** Pick the button copy that matches the chart the application replaces. */
export function applyTimingLabelKey(chart: Chart | null): TimingApplyLabelKey {
  return chart && chart.BPMList.length > 1
    ? "editorPanels.timingDetection.replaceAndApply"
    : "editorPanels.timingDetection.apply";
}
