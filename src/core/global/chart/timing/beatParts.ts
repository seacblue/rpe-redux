/**
 * The three boxes of a beat field, and the beat they describe.
 *
 * A beat is stored as three integers (`whole:numerator/denominator`), but an
 * author can type a decimal into any box. Committing the field folds that decimal
 * back into the stored triple, exactly, without passing through a float:
 *
 * - a decimal in the whole box is the whole beat, so it replaces the fraction the
 *   other boxes hold: `3:3/4` with `3.5` in the whole box becomes `3:1/2`;
 * - a decimal in the numerator box is that many denominatorths, so the parts are
 *   put over a common denominator: `3:3/4` with `3.5` becomes `3:7/8`;
 * - a decimal in the denominator box divides the numerator: `3:3/4` with `3.5`
 *   becomes `3:6/7`.
 *
 * Integer input carries the way the chart reduces anyway (`3:5/4` is `4:1/4`).
 * A part that is not a number, a denominator that is not positive, or a beat the
 * triple cannot store is refused (`null`); the field then turns the boxes invalid
 * and leaves the chart alone.
 *
 * Any box also accepts the whole triple as a shorthand (`3:1/2`, `3,1,2`, or
 * `3 1 2`). Splitting it fills all three boxes, and the same reduction rules
 * apply, so a decimal in the shorthand leaves the boxes as the exact stored
 * parts.
 *
 * A beat is a chart position, so it never lands before zero: a negative draft is
 * clamped to `0:0/1`, matching what `nudgeBeat` already does.
 *
 * The design system draws the boxes but does not own these rules, so this module
 * lives beside the chart's beat scalar and is injected into the field.
 */
import { beatFromBigFraction, compareBeats, type Beat } from "./beat.ts";

/** The three boxes of a beat field. */
export type Parts = [string, string, string];

/** How a beat field reads and writes its three boxes. */
export interface BeatPartsRules {
  /** The three boxes a stored beat is shown as. */
  partsOf(beat: readonly number[]): Parts;
  /** The stored beat three box values describe, or `null` when they are not a beat. */
  reduce(parts: Parts): Beat | null;
  /** The three parts a whole beat typed into one box describes, or `null`. */
  parseShorthand(text: string): Parts | null;
}

/** One box's text as an exact fraction: `3`, `3.5`, `.5` and `3.` are all read. */
interface Fraction {
  numerator: bigint;
  denominator: bigint;
}

/** The chart's start: the one beat a position may not go before. */
const START: Beat = [0, 0, 1];

/** Reads one box as an exact fraction, or null when it is not a number. */
function fractionOf(text: string): Fraction | null {
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text.trim());
  if (!match) {
    return null;
  }
  const [, sign, digits = "", fraction = ""] = match;
  if (!digits && !fraction) {
    return null;
  }
  const denominator = 10n ** BigInt(fraction.length);
  const scaled = (digits ? BigInt(digits) : 0n) * denominator + (fraction ? BigInt(fraction) : 0n);
  return { numerator: sign ? -scaled : scaled, denominator };
}

/** A beat below the chart's start becomes the start itself. */
export function nonNegativeBeat(beat: Beat): Beat {
  return compareBeats(beat, START) < 0 ? [0, 0, 1] : beat;
}

/**
 * The three parts a box's shorthand describes, or `null` when the text is not
 * exactly three numbers.
 *
 * The separators the field shows (`:` and `/`), commas, and whitespace may be
 * mixed, so `3:1/2`, `3,1,2`, and `3 1 2` are the same shorthand. Each token
 * keeps the grammar a single box accepts; fewer or more than three numbers is
 * not a shorthand, so ordinary one-part editing is untouched.
 */
export function partsFromText(text: string): Parts | null {
  const tokens = text.trim().split(/[:/,\s]+/);
  if (tokens.length !== 3 || tokens.some((token) => !fractionOf(token))) {
    return null;
  }
  return [tokens[0], tokens[1], tokens[2]];
}

/** The boxes for a committed beat. */
export function partsOf(beat: readonly number[]): Parts {
  return [String(beat[0]), String(beat[1]), String(beat[2])];
}

/**
 * The beat the boxes describe, or `null` while they are not a beat.
 *
 * The result is a chart position, so a negative draft clamps to `0:0/1` instead
 * of being refused: the field never writes a beat before the chart's start.
 */
export function draftBeat(parts: Parts): Beat | null {
  const whole = fractionOf(parts[0]);
  if (!whole) {
    return null;
  }
  try {
    // Decimal input in the whole box is the beat itself, so it replaces the
    // fraction the other boxes hold.
    if (parts[0].includes(".")) {
      return nonNegativeBeat(beatFromBigFraction(whole.numerator, whole.denominator));
    }
    const numerator = fractionOf(parts[1]);
    const denominator = fractionOf(parts[2]);
    if (!numerator || !denominator || denominator.numerator <= 0n) {
      return null;
    }
    // `whole + numerator/denominator`, each part exact.
    return nonNegativeBeat(
      beatFromBigFraction(
        whole.numerator * numerator.denominator * denominator.numerator +
          numerator.numerator * denominator.denominator * whole.denominator,
        whole.denominator * numerator.denominator * denominator.numerator,
      ),
    );
  } catch {
    return null;
  }
}

/** The chart's own box rules, for the beat field that draws them. */
export const BEAT_PARTS_RULES: BeatPartsRules = {
  partsOf,
  reduce: draftBeat,
  parseShorthand: partsFromText,
};
