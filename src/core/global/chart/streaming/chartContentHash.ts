/**
 * Canonical content hashing shared by whole-chart fingerprints and the streaming
 * line index. Editor-only `id` fields are ignored for line content so a clean
 * line's digest does not depend on whether it has been materialized yet.
 */

const HASH_SEED = 0x811c9dc5;
const HASH_PRIME = 0x01000193;
/** Charts are shallow; deeper data is malformed or hostile and hashes as a marker. */
const MAX_HASH_DEPTH = 64;

const valueCache = new WeakMap<object, number>();
const lineCache = new WeakMap<object, number>();

/** FNV-1a hash over a string, optionally continuing an earlier hash. */
export function hashText(text: string, initial = HASH_SEED): number {
  let hash = initial;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, HASH_PRIME);
  }
  return hash >>> 0;
}

/** Fold one 32-bit word into a running hash. */
function hashWord(hash: number, value: number): number {
  let next = hash;
  next = Math.imul(next ^ (value & 0xff), HASH_PRIME);
  next = Math.imul(next ^ ((value >>> 8) & 0xff), HASH_PRIME);
  next = Math.imul(next ^ ((value >>> 16) & 0xff), HASH_PRIME);
  return Math.imul(next ^ ((value >>> 24) & 0xff), HASH_PRIME) >>> 0;
}

/** Return the cache for one hashing mode. */
function cacheFor(ignoreIds: boolean): WeakMap<object, number> {
  return ignoreIds ? lineCache : valueCache;
}

/** Hash a value with sorted object keys and cycle protection. */
function valueHash(
  value: unknown,
  ignoreIds: boolean,
  stack = new WeakSet<object>(),
  depth = 0,
): number {
  if (value === null) {
    return hashText("null");
  }
  switch (typeof value) {
    case "number":
      return !Number.isFinite(value)
        ? hashText("null")
        : hashText(
            Object.is(value, -0)
              ? '"\\u0000rpe-fingerprint-negative-zero\\u0000"'
              : JSON.stringify(value),
          );
    case "string":
    case "boolean":
      return hashText(JSON.stringify(value));
    case "bigint":
      return hashText(value.toString());
    case "undefined":
    case "function":
    case "symbol":
      return hashText("null");
    default:
      break;
  }

  const object = value as object;
  if (stack.has(object) || depth > MAX_HASH_DEPTH) {
    return hashText("\\u0000rpe-fingerprint-cycle\\u0000");
  }
  const cache = cacheFor(ignoreIds);
  const cached = cache.get(object);
  if (cached !== undefined) {
    return cached;
  }
  let hash = hashText(Array.isArray(value) ? "[" : "{");
  stack.add(object);
  try {
    if (Array.isArray(value)) {
      hash = hashWord(hash, value.length);
      for (const child of value) {
        hash = hashWord(hash, valueHash(child, ignoreIds, stack, depth + 1));
      }
      hash = hashText("]", hash);
    } else {
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record).sort()) {
        if (ignoreIds && key === "id") {
          continue;
        }
        const child = record[key];
        const kind = typeof child;
        if (child === undefined || kind === "function" || kind === "symbol") {
          continue;
        }
        hash = hashText(key, hash);
        hash = hashWord(hash, valueHash(child, ignoreIds, stack, depth + 1));
      }
      hash = hashText("}", hash);
    }
  } finally {
    stack.delete(object);
  }
  cache.set(object, hash >>> 0);
  return hash >>> 0;
}

/** Hash one value as a short opaque digest. */
export function contentFingerprint(value: unknown, options: { ignoreIds?: boolean } = {}): string {
  return valueHash(value, options.ignoreIds === true)
    .toString(16)
    .padStart(8, "0");
}

/** Hash a line while ignoring editor-only object ids. */
export function lineContentFingerprint(line: unknown): string {
  return contentFingerprint(line, { ignoreIds: true });
}

/** Hash the chart fields outside `judgeLineList`, including `META.id`. */
export function headerContentFingerprint(chart: object): string {
  const { judgeLineList: _lines, ...header } = chart as Record<string, unknown>;
  return contentFingerprint(header);
}

/** Combine a header digest and ordered line digests into one chart digest. */
export function combineContentFingerprint(
  headerDigest: string,
  lineDigests: readonly string[],
): string {
  return hashText([headerDigest, ...lineDigests].join("|"))
    .toString(16)
    .padStart(8, "0");
}
