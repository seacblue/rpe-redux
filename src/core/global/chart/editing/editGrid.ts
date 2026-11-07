/**
 * Snap and wheel maths for the note editor's grid.
 *
 * Vertical positions snap to a fixed column count, times snap to exact rational
 * beats through the `TempoGrid` seam, and wheel deltas convert to chart seconds.
 * Only arithmetic lives here; the editor owns gesture state.
 */
import { beatFromFraction, beatValue, fromNumber, type Beat } from "../timing/beat.ts";

/** The vertical grid's spacing, first line offset and selectable line count. */
interface VerticalGrid {
  spacing: number;
  first: number;
  lineCount: number;
}

/**
 * The vertical snap grid.
 *
 * `count` is the total number of selectable lines across the chart field.
 * One line is the centred line; two lines are the left and right boundaries;
 * larger counts are evenly spaced from left to right. Rounding here keeps old
 * persisted fractional values usable while making the setting's meaning match
 * the visible line count.
 */
export function verticalGrid(count = 11): VerticalGrid {
  const value = Number(count);
  const lineCount = Math.max(1, Number.isFinite(value) ? Math.round(value) : 11);
  return {
    spacing: lineCount === 1 ? 1350 : 1350 / (lineCount - 1),
    first: lineCount === 1 ? 0 : -(lineCount - 1) / 2,
    lineCount,
  };
}

/** Snap `value` to the nearest vertical grid line, or return it unchanged when disabled. */
export function snapPosition(value: number, count: number, enabled = true): number {
  if (!enabled) {
    return value;
  }
  const { spacing, first, lineCount } = verticalGrid(count);
  const index = Math.round(value / spacing - first);
  return (Math.min(lineCount - 1, Math.max(0, index)) + first) * spacing;
}

/** The `TempoMap` surface the snap helpers need. */
export interface TempoGrid {
  beat(seconds: number, factor?: number): number;
  seconds(beat: number | readonly number[], factor?: number): number;
}

/**
 * The grid position nearest to `seconds`, as an exact division beat.
 *
 * The snap lands on an integer count of `division`s, so the result is the
 * rational `index / division`.
 */
export function snapTime(seconds: number, division: number, tempo: TempoGrid, factor = 1): Beat {
  const beat = Math.max(0, tempo.beat(seconds, factor));
  const index = Math.floor(beat * division);
  const lower = index / division;
  const upper = (index + 1) / division;
  const nearest =
    Math.abs(tempo.seconds(lower, factor) - seconds) <=
    Math.abs(tempo.seconds(upper, factor) - seconds)
      ? index
      : index + 1;
  // Non-integer divisions are approximated because the format stores exact triples only.
  return Number.isSafeInteger(division) && division > 0
    ? beatFromFraction(nearest, division)
    : fromNumber(nearest / division);
}

/** The beat range spanned by two placements, or null when they are effectively equal. */
export function placementRange(
  first: readonly number[],
  second: readonly number[],
): { start: number; end: number } | null {
  const start = Math.min(beatValue(first), beatValue(second));
  const end = Math.max(beatValue(first), beatValue(second));
  return end - start < 0.001 ? null : { start, end };
}

/**
 * How far one ordinary wheel notch seeks, in beats.
 *
 * The grid division is the count the user sees: four horizontal divisions per
 * beat means one notch moves a quarter beat, eight means an eighth. The wheel
 * speed preference scales that base step from its default of 5 (1x); the
 * optional acceleration grows the step during a held burst. Shift-wheel bypasses
 * this helper and always moves exactly one beat.
 */
export function wheelStepBeats(
  division: number,
  speed = 5,
  accelerated = false,
  burstSeconds = 0,
): number {
  const parts = Number.isFinite(division) && division > 0 ? division : 4;
  const speedScale = Number.isFinite(speed) && speed > 0 ? speed / 5 : 1;
  const acceleration = accelerated ? 1 + 4 * (Math.min(4, Math.max(0, burstSeconds)) / 4) ** 3 : 1;
  return (speedScale * acceleration) / parts;
}
