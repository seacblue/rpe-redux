/**
 * Maps the transport stretch bar's travel onto the timeline's vertical scale.
 *
 * The bar is exponential: equal pointer travel multiplies the scale by the same
 * factor, so the authored 100% sits at the middle of the rail and both halves
 * are equally usable. The rail moves in tenths of a percent and the scale in
 * tenths of a pixel per second, which keeps a drag visually continuous.
 */
import {
  clampTimelineScale,
  TIMELINE_SCALE_DEFAULT,
  TIMELINE_SCALE_MAX,
  TIMELINE_SCALE_MIN,
} from "../../../core/edit/timeline/timelineScale.ts";

/** Largest slider position; the rail runs from 0 (minimum) to this value (maximum). */
export const STRETCH_BAR_MAX = 100;

/** The rail's value precision: one tenth of a percent of the travel. */
export const STRETCH_BAR_STEP = 0.1;

const LOG_SCALE_SPAN = Math.log(TIMELINE_SCALE_MAX / TIMELINE_SCALE_MIN);

/** Clamp a bar position to its travel and quantize it to the rail's step. */
function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return 0;
  }
  const bounded = Math.max(0, Math.min(STRETCH_BAR_MAX, ratio));
  // Quantizing here keeps the slider's controlled value on the same grid the
  // native input steps by; the string round-trip drops float drift such as
  // 90.10000000000001 so the DOM value and the CSS offset stay short.
  return Number((Math.round(bounded / STRETCH_BAR_STEP) * STRETCH_BAR_STEP).toFixed(1));
}

/** The slider position (0-100) that produces `scale`, clamped to the supported range. */
export function stretchBarRatio(scale: number): number {
  const bounded = clampTimelineScale(scale);
  const ratio = (Math.log(bounded / TIMELINE_SCALE_MIN) / LOG_SCALE_SPAN) * STRETCH_BAR_MAX;
  return clampRatio(ratio);
}

/** The scale a slider position (0-100) selects, to a tenth of a pixel per second. */
export function stretchBarScale(ratio: number): number {
  const bounded = clampRatio(ratio);
  const scale = TIMELINE_SCALE_MIN * Math.exp((bounded / STRETCH_BAR_MAX) * LOG_SCALE_SPAN);
  // A tenth of a pixel per second keeps pointer movement continuous while the
  // stored value stays short and the settings readout stays stable.
  return clampTimelineScale(Number(scale.toFixed(1)));
}

/** The scale as a percentage of the authored default, used for the accessible value. */
export function stretchBarPercent(scale: number): number {
  return Math.round((clampTimelineScale(scale) / TIMELINE_SCALE_DEFAULT) * 100);
}
