/**
 * Range-slider geometry, value mapping, and readout rules.
 *
 * The default surface is a filled readout bar with the value printed inside it,
 * drawn twice so the covered half flips to the contrasting ink. A caller can
 * request a thin rail when the control represents a spatial scrollbar rather
 * than a level:
 *
 *   data-slider="level"  the filled readout bar
 *   data-slider="range"  a thin rail with a thumb
 *
 * Without the attribute the filled readout bar is used. Bounds affect value
 * formatting, never the visual design.
 */

import { clamp01 } from "../../core/utils/numbers.ts";

export type SliderReadout = "percent" | "number";

/** `max` for a range input that never declared one is 100, per the HTML spec. */
export function rangeBounds(element: HTMLInputElement): { min: number; max: number } {
  const min = Number(element.min === "" ? 0 : element.min);
  const max = Number(element.max === "" ? 100 : element.max);
  return {
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 100,
  };
}

/**
 * What the readout inside a level bar says. `percent` is PCE's own readout; a
 * bar whose values are not a proportion prints the value instead, because
 * "78%" of a 0-255 channel is a number nobody asked for.
 */
export function sliderReadoutOf(element: HTMLInputElement): SliderReadout {
  const explicit = element.dataset.readout;
  if (explicit === "percent" || explicit === "number") {
    return explicit;
  }
  const { min, max } = rangeBounds(element);
  return min === 0 && (max === 1 || max === 100) ? "percent" : "number";
}

/** Decimals implied by a step, so the readout never shows float drift. */
function decimalsOf(step: string): number {
  const value = Number(step);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    return 0;
  }
  const text = String(step);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : Math.min(3, text.length - dot - 1);
}

/** The fill's width as a percentage of the track, clamped to the track. */
export function ratioOf(element: HTMLInputElement): number {
  const { min, max } = rangeBounds(element);
  const value = Number(element.value);
  if (!Number.isFinite(value) || max <= min) {
    return 0;
  }
  return clamp01((value - min) / (max - min));
}

/** The text a level bar prints for its current value. */
export function readoutText(element: HTMLInputElement): string {
  const value = Number(element.value);
  if (!Number.isFinite(value)) {
    return "";
  }
  if (sliderReadoutOf(element) === "percent") {
    const { max } = rangeBounds(element);
    return `${Math.round(value * (max === 100 ? 1 : 100))}%`;
  }
  return value.toFixed(decimalsOf(element.step));
}
