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
 * formatting, never the visual design. The pointer mapping below measures
 * against the painted track — the padding box, because a range's border is not
 * part of its rail — and clamps points outside it to an end, so a drag can reach
 * either end even when the pointer leaves the control.
 */

import { clamp01 } from "../../core/utils/numbers.ts";
import { writeInputValue } from "./nativeValue.ts";

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

/** The grid a pointer value snaps to; `any` and a missing step mean hundredths. */
const POINTER_STEP = 0.01;

/** The step a pointer snaps to, falling back to hundredths for `any` or an unusable value. */
function pointerStep(step: string): number {
  const value = Number(step);
  return Number.isFinite(value) && value > 0 ? value : POINTER_STEP;
}

/** Step-grid arithmetic accumulates 0.30000000000000004 without this. */
function roundToStep(value: number, step: number): number {
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Number(value.toFixed(Math.min(decimals + 6, 12)));
}

/** The edges a range input's painted track is inset by, in CSS pixels. */
export interface TrackInsets {
  readonly borderLeft: number;
  readonly borderRight: number;
  readonly paddingLeft: number;
  readonly paddingRight: number;
}

/**
 * The painted track inside a range input's border box.
 *
 * A range's rail spans its content box: the border and the padding are painted
 * around it rather than as part of it. Measuring the pointer against the whole
 * border box would make the rail's first pixel worth `(max - min) / width`, so
 * the leftmost point anyone can see would report a value above the start, and
 * that error would grow with the range. A non-positive width reports zero so the
 * caller's endpoint rule takes over.
 */
export function trackBounds(
  box: { left: number; width: number },
  insets: TrackInsets,
): { left: number; width: number } {
  const width =
    box.width - insets.borderLeft - insets.borderRight - insets.paddingLeft - insets.paddingRight;
  return {
    left: box.left + insets.borderLeft + insets.paddingLeft,
    width: Number.isFinite(width) && width > 0 ? width : 0,
  };
}

/** Read a range input's track insets from its computed style. */
function trackInsets(element: HTMLInputElement): TrackInsets {
  const style = getComputedStyle(element);
  const pixels = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  return {
    borderLeft: pixels(style.borderLeftWidth),
    borderRight: pixels(style.borderRightWidth),
    paddingLeft: pixels(style.paddingLeft),
    paddingRight: pixels(style.paddingRight),
  };
}

/**
 * The value a range input takes for a pointer at `clientX`.
 *
 * `bounds` is the input's painted track: the outermost track pixel maps to an
 * end, so the position a user can see is the position they get. Points outside
 * the track clamp to the matching end, which is what lets a drag finish after
 * the pointer has left the control.
 *
 * The result snaps to the nearest step counted from `min`; a missing step or
 * `step="any"` uses hundredths. A non-positive width or NaN coordinate falls
 * back to `min`, and a value that would cross either bound is clamped.
 */
export function valueAtPointer(
  bounds: { left: number; width: number },
  min: number,
  max: number,
  step: string,
  clientX: number,
): number {
  const lower = Number.isFinite(min) ? min : 0;
  const upper = Number.isFinite(max) ? max : lower;
  if (
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.width) ||
    bounds.width <= 0 ||
    upper <= lower
  ) {
    return lower;
  }
  if (clientX <= bounds.left) {
    return lower;
  }
  if (clientX >= bounds.left + bounds.width) {
    return upper;
  }
  if (!Number.isFinite(clientX)) {
    return lower;
  }
  const ratio = clamp01((clientX - bounds.left) / bounds.width);
  const raw = lower + ratio * (upper - lower);
  const stepSize = pointerStep(step);
  const snapped = roundToStep(lower + Math.round((raw - lower) / stepSize) * stepSize, stepSize);
  return Math.min(upper, Math.max(lower, snapped));
}

/**
 * Writes the value under the pointer onto a range input and announces it with
 * a bubbling `input` event. Returns whether the DOM value actually changed,
 * so a drag can emit one `change` at its end instead of one per move.
 */
export function writeRangeValueAtPointer(input: HTMLInputElement, clientX: number): boolean {
  const { min, max } = rangeBounds(input);
  const box = input.getBoundingClientRect();
  // The rail is painted inside the border and padding, so the pointer is mapped
  // against that track. The box itself would make the track's first pixel worth
  // a full step of the range, and on a timeline that is seconds.
  const bounds = trackBounds({ left: box.left, width: box.width }, trackInsets(input));
  const next = valueAtPointer(bounds, min, max, input.step, clientX);
  const current = input.value === "" ? Number.NaN : Number(input.value);
  if (Number.isFinite(current) && current === next) {
    return false;
  }
  writeInputValue(input, String(next));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
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
