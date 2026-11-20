/**
 * The chart's beat field, wired to the chart's own box rules.
 *
 * `BeatField` draws three boxes in the design system, which may not import a
 * chart domain type (`docs/architecture.md`). This module is the one place the
 * two meet: it supplies the chart's rules and narrows the primitive's structural
 * `readonly number[]` back to the chart's own `Beat`, so a product surface
 * imports the field from here and keeps the chart type.
 */
import type { Beat } from "../../../../../core/global/chart/timing/beat.ts";
import { BEAT_PARTS_RULES } from "../../../../../core/global/chart/timing/beatParts.ts";
import {
  BeatField as BeatFieldPrimitive,
  type BeatFieldProps as BeatFieldPrimitiveProps,
} from "../../../../../design/components/input/BeatField.tsx";

export interface BeatFieldProps extends Omit<
  BeatFieldPrimitiveProps,
  "rules" | "value" | "onCommit" | "onNudge" | "accepts" | "same"
> {
  /** The committed beat, read from the chart. */
  value: Beat;
  /** Apply a beat. Return `false` when the owner refused it and the chart is unchanged. */
  onCommit(beat: Beat): boolean | void;
  /** Exact move by one grid division; the owner owns the division. */
  onNudge?(beat: Beat, direction: number): Beat;
  /** Extra rule the owner applies before a beat may land (a Hold's end precedes its start). */
  accepts?(beat: Beat): boolean;
}

/** Edits one chart beat through the three stored parts. */
export function BeatField({ value, onCommit, onNudge, accepts, ...rest }: BeatFieldProps) {
  return (
    <BeatFieldPrimitive
      {...rest}
      value={value}
      rules={BEAT_PARTS_RULES}
      onCommit={(next) => onCommit(next as Beat)}
      onNudge={onNudge ? (next, direction) => onNudge(next as Beat, direction) : undefined}
      accepts={accepts ? (next) => accepts(next as Beat) : undefined}
      same={(left, right) => left.every((part, index) => part === right[index])}
    />
  );
}
