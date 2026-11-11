/**
 * Field types and numeric domains for the selected-event inspector.
 *
 * Event start and end values are authored chart data. Negative opacity hides a
 * line, negative speed reverses scroll, and rotation and translation are
 * arbitrary numbers, so those fields carry no bounds and keep every finite
 * number the author types. Only the structural fields keep their format domain:
 * easing proportions, link-group ids, and colour channels.
 */
import { clamp, clamp01 } from "../../../../../core/utils/numbers.ts";

/** The event fields the inspector can edit. */
export type FieldKey =
  "startTime" | "endTime" | "start" | "end" | "easingLeft" | "easingRight" | "linkgroup";

/** The control family used to edit one event field. */
export type ValueKind = "beat" | "array" | "text" | "number";

/** Native input bounds for one field; an empty object means a free-form value. */
export function eventFieldBounds(field: FieldKey): { min?: number; max?: number } {
  if (field === "easingLeft" || field === "easingRight") {
    return { min: 0, max: 1 };
  }
  if (field === "linkgroup") {
    return { min: 0 };
  }
  return {};
}

/** Native step for one numeric field; free values use `any` so validation never fires. */
export function eventFieldNativeStep(field: FieldKey, step: number): number | "any" {
  const { min, max } = eventFieldBounds(field);
  return min === undefined && max === undefined ? "any" : step;
}

/** One arrow-key step for a free event value, rounded past floating-point residue. */
export function steppedEventValue(
  value: number,
  step: number,
  direction: number,
  multiplier = 1,
): number {
  return Number((value + direction * step * multiplier).toFixed(10));
}

/** Applies the structural domain after parsing; event values pass through unchanged. */
export function normalizeEventNumber(field: FieldKey, value: number): number {
  if (field === "easingLeft" || field === "easingRight") {
    return clamp01(value);
  }
  if (field === "linkgroup") {
    return Math.max(0, Math.round(value));
  }
  return value;
}

/** Parses a comma-separated colour triple and clamps channels to the RPE 0-255 domain. */
export function parseEventArray(text: string): number[] | null {
  const values = text.split(",").map(Number);
  if (values.length !== 3 || values.some((number) => !Number.isFinite(number))) {
    return null;
  }
  return values.map((number) => clamp(number, 0, 255));
}
