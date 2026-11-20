/**
 * The three boxes of a beat field, and the rules that read and write them.
 *
 * The design system draws a beat field but does not own the chart's beat rules,
 * so the caller supplies them here. `BeatParts` is a structural type: three
 * strings, which is all the field itself needs to know. `partsOf` turns a stored
 * beat into the boxes, `reduce` turns the boxes back into the stored value, and
 * `parseShorthand` recognizes a whole beat typed into one box.
 *
 * A rule that the boxes do not describe a beat returns `null`, and the field then
 * paints its invalid state and leaves the caller's value alone.
 */
export type BeatParts = [string, string, string];

/** The beat rules a beat field is drawn with. */
export interface BeatRules {
  /** The three boxes a stored beat is shown as. */
  partsOf(beat: readonly number[]): BeatParts;
  /** The stored beat the boxes describe, or `null` when they are not a beat. */
  reduce(parts: BeatParts): readonly number[] | null;
  /** The three parts a whole beat typed into one box describes, or `null`. */
  parseShorthand?(text: string): BeatParts | null;
}
