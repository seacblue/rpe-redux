/**
 * Value distributions and per-object operations for batch edits.
 *
 * A distribution maps an object's index and progress to a value, where `null`
 * means the object is skipped, and the sequence helpers keep a `_` placeholder
 * distinct from a computed zero.
 */
import { t } from "../../../i18n/index.ts";
import { easing } from "../../utils/easing.ts";
import { compileExpression } from "../../utils/batchScript.ts";
import { beatValue, parseBeat } from "../../global/chart/timing/beat.ts";

/** A compiled value distribution; `null` means "skip this object". */
export type Distribution = (index: number, progress: number) => number | null;

/** The fields consumed by distribution: a whole parameter set or one channel. */
interface DistributionInput {
  lower?: string | number;
  upper?: string | number;
  cycle?: string | number;
  disturbance?: string | number;
  easingType?: number;
}

/** Applies one named batch operation to a value relative to its previous value. */
export function batchOperation(before: number, value: number, operation: string): number {
  switch (operation) {
    case "By":
      return before + value;
    case "To":
      return value;
    case "Times":
      return before * value;
    case "Max":
      return Math.max(before, value);
    case "Min":
      return Math.min(before, value);
    case "Flip":
      return value * 2 - before;
    default:
      throw new Error(t("editor.commands.multiEdit.error.unknownOperation"));
  }
}

/** Parses a comma- or space-separated sequence; `_` becomes null when skipping. */
export function sequence(text: unknown, fallback: number[], skip = false): (number | null)[] {
  const parts = String(text ?? "")
    .trim()
    .split(/[\s,，]+/)
    .filter(Boolean);
  return parts.length
    ? parts.map((part) => (skip && part === "_" ? null : compileExpression(part)({})))
    : fallback;
}

/** Builds a deterministic 32-bit linear congruential generator from a seed. */
export function randomSource(seed: unknown): () => number {
  let state = Number(seed) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Compiles lower/upper/easing/cycle/disturbance settings into a distribution. */
export function distribution(options: DistributionInput, random: () => number): Distribution {
  const lower = compileExpression(String(options.lower ?? 0))({});
  const upper = compileExpression(String(options.upper ?? 0))({});
  return createDistribution(options, random, lower, upper);
}

/** Compiles a distribution whose bounds are entered as chart beats. */
export function beatDistribution(options: DistributionInput, random: () => number): Distribution {
  const lower = beatValue(parseBeat(options.lower ?? 0));
  const upper = beatValue(parseBeat(options.upper ?? 0));
  return createDistribution(options, random, lower, upper);
}

/** Builds the shared distribution behavior after resolving its two bounds. */
function createDistribution(
  options: DistributionInput,
  random: () => number,
  lower: number,
  upper: number,
): Distribution {
  const cycle = sequence(options.cycle, [1], true);
  const disturbance = sequence(options.disturbance, []);
  const easingType = Number(options.easingType ?? 1);
  if (!Number.isInteger(easingType) || easingType < 1 || easingType > 29) {
    throw new Error(t("editor.commands.multiEdit.error.easingRange"));
  }
  return (index, progress) => {
    const multiplier = cycle[index % cycle.length];
    if (multiplier === null) {
      return null;
    }
    let value = lower + (upper - lower) * easing(progress, easingType);
    if (disturbance.length === 1) {
      value += (random() * 2 - 1) * Number(disturbance[0]);
    } else if (disturbance.length === 2) {
      value +=
        Number(disturbance[0]) + random() * (Number(disturbance[1]) - Number(disturbance[0]));
    } else if (disturbance.length) {
      value += Number(disturbance[Math.floor(random() * disturbance.length)]);
    }
    return value * multiplier;
  };
}
