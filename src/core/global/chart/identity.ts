/** Stable identities for chart objects.
 *
 * The chart format stores these as UUID-shaped strings. The timestamp and
 * placement suffix make IDs inspectable, while random bytes remain the source
 * of uniqueness. The suffix is deliberately bounded and never acts as the
 * identity counter by itself.
 */

/** An opaque, UUID-shaped identifier for a chart object. */
export type ChartObjectId = string & { readonly __chartObjectId: unique symbol };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLACEMENT_MODULUS = 100_000_000;

/** Source of chart object IDs. */
interface ChartIdentityFactory {
  /** Return the next unique ID. */
  next(): ChartObjectId;
}

/** Host functions and starting state used to create an ID factory. */
interface ChartIdentityFactoryOptions {
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
  placementCount?: number;
}

/** Fill `length` bytes from the platform random source, falling back to Math.random. */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/** Lowercase hex for every byte in `bytes`. */
function hex(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) {
    value += byte.toString(16).padStart(2, "0");
  }
  return value;
}

/** Wrap a placement counter into the non-negative range the ID layout stores. */
function boundedPlacementCount(value: number): number {
  if (!Number.isSafeInteger(value)) {
    return 0;
  }
  return ((value % PLACEMENT_MODULUS) + PLACEMENT_MODULUS) % PLACEMENT_MODULUS;
}

/** Create UUID-shaped IDs whose timestamp and placement suffix stay inspectable. */
export function createChartIdentityFactory(
  options: ChartIdentityFactoryOptions = {},
): ChartIdentityFactory {
  const now = options.now ?? Date.now;
  const source = options.randomBytes ?? randomBytes;
  let placementCount = boundedPlacementCount(options.placementCount ?? 0);
  // Draw entropy in pooled batches and slice it per ID.
  const poolSize = 9 * 512;
  let pool: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let poolCursor = poolSize;
  const entropyBytes = (): Uint8Array => {
    if (poolCursor + 9 > pool.length) {
      pool = source(poolSize);
      poolCursor = 0;
    }
    const start = poolCursor;
    poolCursor += 9;
    return pool.subarray(start, poolCursor);
  };

  /**
   * Build the id as one flat string.
   *
   * V8 represents a template-literal interpolation as a `ConsString`: a binary
   * tree of references to its parts, and `String.prototype.slice` on a flat string
   * returns a `SlicedString` that keeps its parent alive. Both retain far more than
   * the characters they show — a 36-character id built that way costs about
   * 360 B, while a flat string of the same length costs about 80 B. Charts hold one
   * id per object and a dense chart holds hundreds of thousands, so every id here
   * is a single `join` over complete parts: no slice, no rope.
   */
  return {
    next(): ChartObjectId {
      const timestamp = Math.max(0, Math.trunc(now())) % 0x1_0000_0000_0000;
      const suffix = boundedPlacementCount(placementCount);
      placementCount = (placementCount + 1) % PLACEMENT_MODULUS;
      const entropy = entropyBytes();
      const timestampHex = timestamp.toString(16).padStart(12, "0");
      const randomVersionBits = ((entropy[0] << 4) | (entropy[1] >>> 4)) & 0x0fff;
      const placementHigh = Math.trunc(suffix / 0x4000);
      const placementLow = suffix % 0x4000;
      // `join` allocates one flat string and copies every part into it, which is
      // what keeps the id's retained size proportional to its length.
      return [
        timestampHex.slice(0, 8),
        timestampHex.slice(8),
        (0x7000 | randomVersionBits).toString(16).padStart(4, "0"),
        (0x8000 | placementHigh).toString(16).padStart(4, "0"),
        placementLow.toString(16).padStart(4, "0") + hex(entropy.subarray(2, 6)),
      ].join("-") as ChartObjectId;
    },
  };
}

const defaultFactory = createChartIdentityFactory();

/** Create one ID from the default factory. */
export function createChartObjectId(): ChartObjectId {
  return defaultFactory.next();
}

/** True when `value` is a well-formed chart object ID. */
export function isChartObjectId(value: unknown): value is ChartObjectId {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
