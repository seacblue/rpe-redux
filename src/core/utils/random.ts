/**
 * Cryptographically secure random helpers shared by core and frontend code.
 *
 * Range selection uses rejection sampling so every integer in the requested
 * interval has the same probability, including when the interval is not a
 * divisor of the 32-bit source space.
 */

const UINT32_SPACE = 0x1_0000_0000;

/** Return one cryptographically secure integer in the inclusive range. */
export function secureRandomIntInclusive(min: number, max: number): number {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
    throw new RangeError("Random integer bounds must be ordered safe integers.");
  }
  const range = max - min + 1;
  if (range > UINT32_SPACE) {
    throw new RangeError("Random integer range must fit in one unsigned 32-bit value.");
  }
  const limit = UINT32_SPACE - (UINT32_SPACE % range);
  const values = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return min + (values[0] % range);
}
