/**
 * Fits numeric canvas labels without compressing their glyphs.
 *
 * Numeric readouts keep their font size and horizontal scale. When a value does
 * not fit its column, decimal places are removed one at a time; if even the
 * integer form does not fit, the original text is returned so the caller can
 * draw it at full width and let neighbours overlap instead of squeezing it.
 */
const DECIMAL_NUMBER = /(-?\d+)\.(\d+)/gu;

/** Return the text with every decimal number cut to `digits` places. */
function withPrecision(text: string, digits: number): string {
  return text.replace(DECIMAL_NUMBER, (_match, integer: string, fraction: string) =>
    digits === 0 ? integer : `${integer}.${fraction.slice(0, digits)}`,
  );
}

/**
 * Shorten decimal places until `text` fits `maxWidth`.
 *
 * Returns the original text when it has no decimals or when the integer form is
 * still too wide; the caller must draw the result without a max-width so the
 * glyphs are never horizontally scaled.
 */
export function fitNumericText(
  text: string,
  maxWidth: number,
  measureText: (value: string) => number,
): string {
  if (measureText(text) <= maxWidth) {
    return text;
  }
  const matches = [...text.matchAll(DECIMAL_NUMBER)];
  if (matches.length === 0) {
    return text;
  }
  const maxDigits = Math.max(...matches.map((match) => match[2].length));
  for (let digits = maxDigits - 1; digits >= 0; digits -= 1) {
    const candidate = withPrecision(text, digits);
    if (measureText(candidate) <= maxWidth) {
      return candidate;
    }
  }
  return text;
}
