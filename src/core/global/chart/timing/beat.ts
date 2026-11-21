/**
 * The beat: what a position in the chart is measured in.
 *
 * This is the chart's own scalar, not a time. A beat is the **reduced rational
 * triple** `[whole, numerator, denominator]` the format stores verbatim — `3:1/2`
 * is beat `3.5` — so a position is exact and survives a save/load round trip without
 * the drift a float would pick up. `beatValue` is the only way to reach the number;
 * `fromNumber` is the only way back, and it reduces.
 *
 * Beats are exactly representable as a number, so the tuple is *not* how the chart is
 * computed with — every read converts once through `beatValue`, and every write
 * converts once through `fromNumber`. The tuple's job is to be a faithful, stable
 * on-disk and in-memory *representation*.
 *
 * Conversion to seconds — the thing that depends on the tempo map — is `tempo.ts`.
 */
import { t } from "../../../../i18n/index.ts";

/** A reduced beat triple: `[whole, numerator, denominator]`. */
export type Beat = [number, number, number];
/** Whether a value is a structurally valid beat triple; the predicate behind `assertChart`. */
export function isBeat(value: unknown): value is Beat {
  return (
    Array.isArray(value) && value.length === 3 && value.every(Number.isSafeInteger) && value[2] > 0
  );
}

/** Whether two beat values form a drawable range, allowing zero duration. */
export function isOrderedBeatRange(start: unknown, end: unknown): boolean {
  if (typeof start === "number" && typeof end === "number") {
    return Number.isFinite(start) && Number.isFinite(end) && end >= start;
  }
  return isBeat(start) && isBeat(end) && compareBeats(end, start) >= 0;
}

/** Convert a beat triple to its numeric value, throwing on a malformed tuple. */
export function beatValue(beat: readonly number[], path = "beat"): number {
  if (!isBeat(beat)) {
    throw new Error(t("model.beat.invalidTuple", { path }));
  }
  return beat[0] + beat[1] / beat[2];
}

/**
 * A mutable copy of a beat that keeps the triple shape.
 */
export function beatCopy(beat: Beat): Beat {
  return [beat[0], beat[1], beat[2]];
}

/** Reduce a raw triple to the canonical non-negative-fraction form. */
export function normalizeBeat(beat: readonly number[]): Beat {
  const parts: bigint[] = beat.map((value: number) => BigInt(value));
  let whole = parts[0];
  let numerator = parts[1];
  let denominator = parts[2];
  if (denominator <= 0n) {
    denominator = 1n;
  }
  whole += numerator / denominator;
  numerator %= denominator;
  if (numerator < 0n) {
    numerator += denominator;
    whole--;
  }
  let a = numerator,
    b = denominator;
  while (b) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  if (a) {
    numerator /= a;
    denominator /= a;
  }
  const result = [whole, numerator, denominator].map(Number);
  if (!result.every(Number.isSafeInteger)) {
    throw new Error(t("model.beat.outOfRange"));
  }
  return result as Beat;
}

/**
 * A beat from a number, reduced over `denominator`.
 *
 * `denominator` sets the resolution for a value that did not come from a triple;
 * the default is 10000.
 */
export function fromNumber(value: number, denominator = 10000): Beat {
  if (!Number.isFinite(value) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error(t("model.beat.invalid"));
  }
  const whole = Math.floor(value);
  return normalizeBeat([whole, Math.floor((value - whole) * denominator), denominator]);
}

/**
 * Reduce a numeric or triple beat input to the canonical triple.
 *
 * A triple is the exact representation and is only reduced. A number is the
 * continuous boundary; it is quantized once over {@link fromNumber}'s default
 * resolution, so callers that already hold a triple must pass it through.
 */
export function toBeat(value: number | readonly number[]): Beat {
  return typeof value === "number" ? fromNumber(value) : normalizeBeat(value);
}

/** Sum two beats exactly and return the reduced triple. */
export function addBeats(left: readonly number[], right: readonly number[]): Beat {
  const [a, b, c] = left.map((value: number) => BigInt(value));
  const [d, e, f] = right.map((value: number) => BigInt(value));
  const result = [a + d, b * f + e * c, c * f];
  return normalizeBeat(result.map((value) => Number(value)));
}

/**
 * The beat `whole:numerator/denominator`, from three integers.
 *
 * This is the write path for an author's own input: the three boxes are already
 * the stored shape, so nothing passes through a float and nothing is lost. A
 * part that is not a safe integer, or a denominator that is not positive, is
 * refused.
 */
export function beatFromParts(whole: number, numerator: number, denominator: number): Beat {
  if (![whole, numerator, denominator].every(Number.isSafeInteger) || denominator <= 0) {
    throw new Error(t("model.beat.invalidTuple", { path: "beat" }));
  }
  return normalizeBeat([whole, numerator, denominator]);
}

/** `numerator/denominator` as a beat: one grid division, exact. */
export function beatFromFraction(numerator: number, denominator: number): Beat {
  return beatFromParts(0, numerator, denominator);
}

/**
 * A beat from an exact fraction of big integers.
 *
 * The fraction is carried and reduced in `BigInt`, then checked to fit in safe
 * integers; a denominator of zero or below, or an unstorable result, is refused.
 */
export function beatFromBigFraction(numerator: bigint, denominator: bigint): Beat {
  if (denominator <= 0n) {
    throw new Error(t("model.beat.invalid"));
  }
  // Whole part and a remainder that shares the denominator's sign, so the fraction
  // is never negative: `[-1, 1, 2]` is `-0.5`, not `[0, -1, 2]`.
  let whole = numerator / denominator;
  let remainder = numerator % denominator;
  if (remainder < 0n) {
    remainder += denominator;
    whole -= 1n;
  }
  let a = remainder;
  let b = denominator;
  while (b) {
    const rest = a % b;
    a = b;
    b = rest;
  }
  if (a > 0n) {
    remainder /= a;
    denominator /= a;
  }
  const low = BigInt(Number.MIN_SAFE_INTEGER);
  const high = BigInt(Number.MAX_SAFE_INTEGER);
  if (![whole, remainder, denominator].every((part) => part >= low && part <= high)) {
    throw new Error(t("model.beat.outOfRange"));
  }
  return [Number(whole), Number(remainder), Number(denominator)];
}

/** `beat + numerator/denominator`, exact in the triple. */
export function addBeatFraction(
  beat: readonly number[],
  numerator: number,
  denominator: number,
): Beat {
  return addBeats(beat, beatFromFraction(numerator, denominator));
}

/** `left - right`, exact in the triple. */
export function subtractBeats(left: readonly number[], right: readonly number[]): Beat {
  return addBeats(left, [-right[0], -right[1], right[2]]);
}

/**
 * Compare two beats by value without going through a float: `-1`, `0` or `1`.
 *
 * The comparison uses the integer numerators, so equal values compare equal even
 * when their triples differ.
 */
export function compareBeats(left: readonly number[], right: readonly number[]): number {
  if (!isBeat(left) || !isBeat(right)) {
    throw new Error(t("model.beat.invalidTuple", { path: "beat" }));
  }
  const [aw, an, ad] = left.map((value: number) => BigInt(value));
  const [bw, bn, bd] = right.map((value: number) => BigInt(value));
  // Both sides are `value * ad * bd`: compare the numerators only.
  const a = (aw * ad + an) * bd;
  const b = (bw * bd + bn) * ad;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The smaller of two beats, normalized to a triple. */
export function minBeat(left: Beat, right: readonly number[]): Beat {
  return compareBeats(left, right) <= 0 ? left : normalizeBeat(right);
}

/** The larger of two beats, normalized to a triple. */
export function maxBeat(left: Beat, right: readonly number[]): Beat {
  return compareBeats(left, right) >= 0 ? left : normalizeBeat(right);
}

/**
 * Move a beat by `direction` grid divisions, exact.
 *
 * The result never goes before zero.
 */
export function nudgeBeat(beat: readonly number[], direction: number, division: number): Beat {
  const next = addBeatFraction(beat, direction, Math.max(1, division));
  return compareBeats(next, [0, 0, 1]) < 0 ? [0, 0, 1] : next;
}

/** `3:1/2` from text, or any number from text or number. */
export function parseBeat(text: string | number): Beat {
  if (typeof text === "number") {
    return fromNumber(text);
  }
  const match = String(text)
    .trim()
    .match(/^(-?\d+)\s*:\s*(-?\d+)\s*\/\s*(\d+)$/);
  if (match) {
    const beat = match.slice(1).map(Number) as Beat;
    beatValue(beat);
    return beat;
  }
  if (String(text).trim() === "") {
    throw new Error(t("model.beat.empty"));
  }
  return fromNumber(Number(text));
}

/** Format a beat as the stored `whole:numerator/denominator` text. */
export function formatBeat(beat: readonly number[]): string {
  return `${beat[0]}:${beat[1]}/${beat[2]}`;
}
