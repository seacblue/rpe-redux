/**
 * Computes the canonical chart revision used by every document-facing seam.
 *
 * The identity of a chart is its content, and callers only compare these
 * strings for equality (dirty tracking, save/load revisions, and Code Cell preconditions).
 *
 * The revision uses sorted object keys and recursively cached structural hashes:
 * unchanged note/event objects keep their digest across immutable chart edits,
 * while a new array walks only its references and the newly inserted values.
 * Line, header, and whole-chart digests are WeakMap-backed.
 *
 * The digest value is opaque; equal content yields equal fingerprints. Sorting
 * object keys recursively and preserving the `-0` distinction keep that true.
 */

import { type Chart } from "../../global/chart/chart.ts";
import { yieldToHost } from "../../utils/yieldToHost.ts";

const wholeChartCache = new WeakMap<object, string>();
const headerCache = new WeakMap<object, string>();
const lineCache = new WeakMap<object, string>();
const valueHashCache = new WeakMap<object, number>();
const warmPromises = new WeakMap<object, Promise<string>>();

const HASH_SEED = 0x811c9dc5;
const HASH_PRIME = 0x01000193;
/** Charts are shallow; deeper data is malformed or hostile and hashes as a marker. */
const MAX_HASH_DEPTH = 64;

/** FNV-1a hash over a string, optionally continuing an earlier hash. */
function hashText(text: string, initial = HASH_SEED): number {
  let hash = initial;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, HASH_PRIME);
  }
  return hash >>> 0;
}

/** Folds one 32-bit word into a running hash. */
function hashWord(hash: number, value: number): number {
  let next = hash;
  next = Math.imul(next ^ (value & 0xff), HASH_PRIME);
  next = Math.imul(next ^ ((value >>> 8) & 0xff), HASH_PRIME);
  next = Math.imul(next ^ ((value >>> 16) & 0xff), HASH_PRIME);
  return Math.imul(next ^ ((value >>> 24) & 0xff), HASH_PRIME) >>> 0;
}

/** Hash chart values without rebuilding a large canonical string on every edit. */
function valueHash(value: unknown, stack = new WeakSet<object>(), depth = 0): number {
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
  // A chart can acquire a back-reference from an extension hook (`chart:parsed`
  // and `chart:validate` receive the object graph). Hashing must terminate for
  // that graph rather than walk the cycle until the stack overflows.
  if (stack.has(object) || depth > MAX_HASH_DEPTH) {
    return hashText("\\u0000rpe-fingerprint-cycle\\u0000");
  }
  const cached = valueHashCache.get(object);
  if (cached !== undefined) {
    return cached;
  }
  let hash = hashText(Array.isArray(value) ? "[" : "{");
  stack.add(object);
  try {
    if (Array.isArray(value)) {
      hash = hashWord(hash, value.length);
      for (const child of value) {
        hash = hashWord(hash, valueHash(child, stack, depth + 1));
      }
      hash = hashText("]", hash);
    } else {
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record).sort()) {
        const child = record[key];
        const kind = typeof child;
        if (child === undefined || kind === "function" || kind === "symbol") {
          continue;
        }
        hash = hashText(key, hash);
        hash = hashWord(hash, valueHash(child, stack, depth + 1));
      }
      hash = hashText("}", hash);
    }
  } finally {
    stack.delete(object);
  }
  valueHashCache.set(object, hash >>> 0);
  return hash >>> 0;
}

/** Fingerprint of the chart fields outside `judgeLineList`. */
function headerFingerprint(chart: Chart): string {
  const cached = headerCache.get(chart);
  if (cached) {
    return cached;
  }
  const { judgeLineList: _lines, ...header } = chart as Chart & Record<string, unknown>;
  const digest = valueHash(header).toString(16).padStart(8, "0");
  headerCache.set(chart, digest);
  return digest;
}

/** Cached fingerprint of one judge line. */
function lineFingerprint(line: unknown): string {
  if (!line || typeof line !== "object") {
    return valueHash(line).toString(16).padStart(8, "0");
  }
  const cached = lineCache.get(line);
  if (cached) {
    return cached;
  }
  const digest = valueHash(line).toString(16).padStart(8, "0");
  lineCache.set(line, digest);
  return digest;
}

interface AsyncHashState {
  deadline: number;
}

/** Async value hash that yields between chunks of a large nested array. */
async function valueHashAsync(
  value: unknown,
  state: AsyncHashState,
  stack = new WeakSet<object>(),
  depth = 0,
): Promise<number> {
  if (value === null || typeof value !== "object") {
    return valueHash(value);
  }
  const object = value as object;
  if (stack.has(object) || depth > MAX_HASH_DEPTH) {
    return hashText("\\u0000rpe-fingerprint-cycle\\u0000");
  }
  const cached = valueHashCache.get(object);
  if (cached !== undefined) {
    return cached;
  }
  const yieldIfNeeded = async (): Promise<void> => {
    if (performance.now() >= state.deadline) {
      await yieldToHost();
      state.deadline = performance.now() + 6;
    }
  };
  let hash = hashText(Array.isArray(value) ? "[" : "{");
  stack.add(object);
  try {
    if (Array.isArray(value)) {
      hash = hashWord(hash, value.length);
      for (const child of value) {
        const childHash =
          child && typeof child === "object"
            ? await valueHashAsync(child, state, stack, depth + 1)
            : valueHash(child);
        hash = hashWord(hash, childHash);
        await yieldIfNeeded();
      }
      hash = hashText("]", hash);
    } else {
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record).sort()) {
        const child = record[key];
        const kind = typeof child;
        if (child === undefined || kind === "function" || kind === "symbol") {
          continue;
        }
        hash = hashText(key, hash);
        const childHash =
          child && typeof child === "object"
            ? await valueHashAsync(child, state, stack, depth + 1)
            : valueHash(child);
        hash = hashWord(hash, childHash);
        await yieldIfNeeded();
      }
      hash = hashText("}", hash);
    }
  } finally {
    stack.delete(object);
  }
  valueHashCache.set(object, hash >>> 0);
  return hash >>> 0;
}

/** Async cached fingerprint of one judge line. */
async function lineFingerprintAsync(line: unknown, state: AsyncHashState): Promise<string> {
  if (!line || typeof line !== "object") {
    return valueHash(line).toString(16).padStart(8, "0");
  }
  const cached = lineCache.get(line);
  if (cached) {
    return cached;
  }
  const digest = (await valueHashAsync(line, state)).toString(16).padStart(8, "0");
  lineCache.set(line, digest);
  return digest;
}

/** Seed a fingerprint computed off-thread for a freshly installed chart. */
export function primeChartFingerprint(chart: Chart, fingerprint: string): void {
  wholeChartCache.set(chart, fingerprint);
}

/**
 * Warm the fingerprint cache without holding the UI thread for one long task.
 *
 * Document installation yields between lines so the loading surface and pointer
 * overlays keep painting; edit boundaries use the synchronous version.
 */
export function warmChartFingerprintAsync(chart: Chart): Promise<string> {
  const active = warmPromises.get(chart);
  if (active) {
    return active;
  }
  // A chart loaded off-thread may already have its whole-chart digest seeded
  // while its per-line and per-value caches are still cold. Warm those caches
  // too, so the first edit hashes only the changed line.
  const seeded = wholeChartCache.get(chart);
  const work = (async () => {
    const lines = chart.judgeLineList ?? [];
    const parts: string[] = [headerFingerprint(chart)];
    const state: AsyncHashState = { deadline: performance.now() + 6 };
    for (const line of lines) {
      parts.push(await lineFingerprintAsync(line, state));
    }
    const digest = hashText(parts.join("|")).toString(16).padStart(8, "0");
    wholeChartCache.set(chart, seeded ?? digest);
    return seeded ?? digest;
  })().finally(() => {
    warmPromises.delete(chart);
  });
  warmPromises.set(chart, work);
  return work;
}

/** Computes the canonical chart revision used by every document-facing seam. */
export function chartFingerprint(chart: Chart): string;
export function chartFingerprint(chart: Chart | null | undefined): string | null;
export function chartFingerprint(chart: Chart | null | undefined): string | null {
  if (!chart) {
    return null;
  }
  const cached = wholeChartCache.get(chart);
  if (cached) {
    return cached;
  }
  const lines = chart.judgeLineList ?? [];
  const parts: string[] = [headerFingerprint(chart)];
  for (const line of lines) {
    parts.push(lineFingerprint(line));
  }
  const digest = hashText(parts.join("|")).toString(16).padStart(8, "0");
  wholeChartCache.set(chart, digest);
  return digest;
}
