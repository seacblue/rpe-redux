/**
 * Canonical content hashing shared by whole-chart fingerprints and the streaming
 * line index.
 *
 * Editor-only `id` fields are ignored for line content so a clean line's digest
 * does not depend on whether it has been materialized yet. The digest values are
 * part of the chart identity: the Rust streaming index reimplements the same
 * FNV-1a frame and cross-checks the line vector, so the fold below must stay
 * bit-identical to `src-tauri/src/documents/chart_stream/index.rs`.
 *
 * Large object arrays (note, event, and layer arrays) carry a seed: cached child
 * digests plus the fold state before each fixed-size block. A transaction clones
 * such an array copy-on-write, announces the clone with
 * `inheritValueContentFingerprint`, marks it dirty when it mutates it, and the
 * next hash compares child identities against the immutable seed anchor. Only
 * changed children are hashed and only the suffix after the nearest checkpoint
 * is re-folded, so an edit costs one integer fold instead of a full per-child
 * FNV walk with a `WeakMap` lookup per child and a whole-array copy.
 */

import type { ChartLineRevisionSeed } from "./chartRevisionSeed.ts";

const HASH_SEED = 0x811c9dc5;
const HASH_PRIME = 0x01000193;
/** Charts are shallow; deeper data is malformed or hostile and hashes as a marker. */
const MAX_HASH_DEPTH = 64;
const KEY_SHAPE_CACHE_LIMIT = 1024;
const PRIMITIVE_HASH_CACHE_LIMIT = 8192;
/** Fixed array-block size for the cached fold checkpoints. */
const ARRAY_BLOCK_SIZE = 256;
/** Shorter arrays are cheap to re-fold directly, so they skip seed allocation. */
const ARRAY_SEED_MIN_LENGTH = 64;

const valueCache = new WeakMap<object, number>();
const lineCache = new WeakMap<object, number>();
const sortedKeyCache = new Map<string, readonly string[]>();
const linePartsCache = new WeakMap<object, ReadonlyMap<string, number>>();
const lineSeedCache = new WeakMap<object, ReadonlyMap<string, { value: unknown; hash: number }>>();
const valueSeedCache = new WeakMap<object, ReadonlyMap<string, { value: unknown; hash: number }>>();
/**
 * Cached fingerprint data for one object array.
 *
 * `anchor` is an array snapshot that is never mutated after seeding: a
 * copy-on-write clone anchors on the immutable source array, and a freshly
 * hashed array anchors on itself until a later clone takes over. `hashes` holds
 * the child digests aligned with the anchor, `checkpoints[block]` the fold state
 * before that fixed-size block, and `clean` records whether the live array still
 * matches the anchor. A dirty array reconciles against the anchor: unchanged
 * children reuse their cached digest and the fold resumes from the nearest
 * checkpoint, which reproduces the cold digest exactly. `partial` marks a seed
 * received from a parser worker whose child-hash vector still has gaps for
 * primitive children; the first reconcile fills them before folding.
 */
interface ArrayFingerprintSeed {
  anchor: readonly unknown[];
  hashes: readonly (number | undefined)[];
  hash: number;
  checkpoints: readonly number[] | null;
  clean: boolean;
  partial: boolean;
}

const arraySeedCache = new WeakMap<object, ArrayFingerprintSeed>();
const primitiveHashCache = new Map<string, number>();

/** Hashes for object containers and their object-array children. */
export interface ChartValueDigestGroup {
  readonly path: readonly (string | number)[];
  readonly digest: number;
  readonly children?: readonly (number | undefined)[];
  readonly childDigests?: Readonly<Record<string, number>>;
}

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

/** Encode an object-key sequence without collisions from separators in keys. */
function keyShape(keys: readonly string[]): string {
  let shape = "";
  for (const key of keys) {
    shape += `${key.length}:${key}`;
  }
  return shape;
}

/** Reuse sorted key arrays for the repeated object shapes in event tracks. */
function sortedKeys(record: Record<string, unknown>): readonly string[] {
  const keys = Object.keys(record);
  if (keys.length < 2) {
    return keys;
  }
  let alreadySorted = true;
  for (let index = 1; index < keys.length; index += 1) {
    if (keys[index - 1] > keys[index]) {
      alreadySorted = false;
      break;
    }
  }
  if (alreadySorted) {
    return keys;
  }
  const shape = keyShape(keys);
  const cached = sortedKeyCache.get(shape);
  if (cached) {
    return cached;
  }
  const sorted = Object.freeze([...keys].sort());
  if (sortedKeyCache.size < KEY_SHAPE_CACHE_LIMIT) {
    sortedKeyCache.set(shape, sorted);
  }
  return sorted;
}

/** Match JSON's finite-number spelling while avoiding stringify for common integers. */
function numberText(value: number): string {
  if (!Number.isFinite(value)) {
    return "null";
  }
  if (Object.is(value, -0)) {
    return '"\\u0000rpe-fingerprint-negative-zero\\u0000"';
  }
  if (Number.isInteger(value) && Math.abs(value) < 1e21) {
    return String(value);
  }
  return JSON.stringify(value);
}

/** Hash a repeated primitive without retaining unbounded chart text. */
function primitiveHash(key: string, text: string): number {
  if (text.length > 128) {
    return hashText(text);
  }
  const cacheKey = `${key}:${text}`;
  const cached = primitiveHashCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const hash = hashText(text);
  if (primitiveHashCache.size < PRIMITIVE_HASH_CACHE_LIMIT) {
    primitiveHashCache.set(cacheKey, hash);
  }
  return hash;
}

/**
 * Revision seed for one parsed judge line.
 *
 * The seed carries only the transferable digest data: value digests are tied to
 * the live object identity, so they stay out of a seed that may cross a worker
 * boundary.
 */
export function lineRevisionSeed(line: unknown): ChartLineRevisionSeed {
  const parts = lineContentFingerprintParts(line);
  return { digest: parts.digest, childDigests: parts.childDigests };
}

/** Fold one raw judge-line JSON source into the revision seed the paged document stores. */
export function lineRevisionSeedFromJson(raw: string): ChartLineRevisionSeed {
  let line: unknown;
  try {
    line = JSON.parse(raw);
  } catch {
    line = null;
  }
  return lineRevisionSeed(line);
}

/** Hash one line and retain the digest of each top-level child. */
export function lineContentFingerprintParts(
  line: unknown,
  options: { includeValueDigests?: boolean } = {},
): {
  digest: string;
  childDigests: Readonly<Record<string, number>>;
  valueDigests?: readonly ChartValueDigestGroup[];
} {
  const children: Record<string, number> = {};
  const digest = valueHash(line, true, new WeakSet<object>(), 0, children)
    .toString(16)
    .padStart(8, "0");
  return {
    digest,
    childDigests: children,
    ...(options.includeValueDigests ? { valueDigests: collectValueDigests(line) } : {}),
  };
}

/** Collect hashes for reusable containers without descending into leaf records. */
function collectValueDigests(value: unknown): readonly ChartValueDigestGroup[] {
  const groups: ChartValueDigestGroup[] = [];
  const seen = new WeakSet<object>();
  const hasObjectChildren = (current: readonly unknown[]): boolean =>
    current.some((child) => child && typeof child === "object");
  const hasObjectArrayChild = (record: Record<string, unknown>): boolean =>
    Object.values(record).some((child) => Array.isArray(child) && hasObjectChildren(child));
  const visit = (current: unknown, path: readonly (string | number)[]): void => {
    if (!current || typeof current !== "object") {
      return;
    }
    const object = current as object;
    if (seen.has(object)) {
      return;
    }
    seen.add(object);
    if (Array.isArray(current)) {
      if (!hasObjectChildren(current)) {
        return;
      }
      const children: (number | undefined)[] = [];
      for (const child of current) {
        if (child && typeof child === "object") {
          const childDigest = lineCache.get(child as object);
          children.push(childDigest ?? valueHash(child, true));
        } else {
          children.push(undefined);
        }
      }
      const digest = lineCache.get(object);
      if (digest !== undefined) {
        groups.push({ path, digest, children });
      }
      for (let index = 0; index < current.length; index += 1) {
        const child = current[index];
        if (
          child &&
          typeof child === "object" &&
          hasObjectArrayChild(child as Record<string, unknown>)
        ) {
          visit(child, [...path, index]);
        }
      }
    } else {
      const record = current as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (key === "id") {
          continue;
        }
        const child = record[key];
        const kind = typeof child;
        if (child === undefined || kind === "function" || kind === "symbol") {
          continue;
        }
        if (child && typeof child === "object") {
          if (Array.isArray(child)) {
            visit(child, [...path, key]);
          } else if (hasObjectArrayChild(child as Record<string, unknown>)) {
            visit(child, [...path, key]);
          }
        }
      }
      const digest = lineCache.get(object);
      if (digest !== undefined && (path.length === 0 || hasObjectArrayChild(record))) {
        const childDigests: Record<string, number> = {};
        for (const key of sortedKeys(record)) {
          if (key === "id") {
            continue;
          }
          const child = record[key];
          const kind = typeof child;
          if (child === undefined || kind === "function" || kind === "symbol") {
            continue;
          }
          childDigests[key] = valueHash(child, true, new WeakSet<object>(), 1);
        }
        groups.push({ path, digest, childDigests });
      }
    }
  };
  visit(value, []);
  return groups;
}

/** Seed a materialized line from the worker's top-level child hashes. */
export function primeLineContentFingerprint(
  line: object,
  digest: string,
  childDigests: Readonly<Record<string, number>> | undefined,
  valueDigests?: readonly ChartValueDigestGroup[],
): void {
  if (!childDigests) {
    return;
  }
  const parts = new Map<string, { value: unknown; hash: number }>();
  for (const key of Object.keys(childDigests)) {
    parts.set(key, { value: (line as Record<string, unknown>)[key], hash: childDigests[key] });
  }
  lineSeedCache.set(line, parts);
  linePartsCache.set(line, new Map(Object.entries(childDigests)));
  lineCache.set(line, Number.parseInt(digest, 16) >>> 0);
  if (valueDigests?.length) {
    primeValueDigestGroups(line, valueDigests);
  }
}

/** Install reusable object and array hashes received from the parser worker. */
function primeValueDigestGroups(line: object, groups: readonly ChartValueDigestGroup[]): void {
  const resolve = (path: readonly (string | number)[]): unknown => {
    let current: unknown = line;
    for (const segment of path) {
      if (!current || typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string | number, unknown>)[segment];
    }
    return current;
  };
  for (const group of groups) {
    const current = resolve(group.path);
    if (!current || typeof current !== "object") {
      continue;
    }
    lineCache.set(current, group.digest >>> 0);
    if (group.children && Array.isArray(current) && group.children.length === current.length) {
      arraySeedCache.set(current, {
        anchor: current,
        hashes: group.children,
        hash: group.digest >>> 0,
        checkpoints: null,
        clean: true,
        partial: group.children.includes(undefined),
      });
    } else if (group.childDigests && !Array.isArray(current)) {
      const seed = new Map<string, { value: unknown; hash: number }>();
      for (const [key, hash] of Object.entries(group.childDigests)) {
        seed.set(key, { value: (current as Record<string, unknown>)[key], hash });
      }
      valueSeedCache.set(current, seed);
    }
  }
}

/** Carry reusable object and array hashes onto a copy-on-write shell. */
export function inheritValueContentFingerprint(source: object, target: object): void {
  const valueSeed = valueSeedCache.get(source);
  if (valueSeed) {
    valueSeedCache.set(target, valueSeed);
  }
  const arraySeed = arraySeedCache.get(source);
  if (arraySeed && Array.isArray(target)) {
    // Every caller copies the source array shallowly, so the target content
    // equals `source` right now. Anchor on the immutable source instead of
    // snapshotting the target: later mutations stay detectable by identity and
    // the whole-array copy disappears. The worker's child-hash vector is shared
    // until a mutation replaces an entry.
    const anchored = Array.isArray(source) && arraySeed.clean;
    arraySeedCache.set(target, {
      anchor: anchored ? (source as readonly unknown[]) : arraySeed.anchor,
      hashes: arraySeed.hashes,
      hash: arraySeed.hash,
      checkpoints: arraySeed.checkpoints,
      clean: anchored,
      partial: arraySeed.partial,
    });
  }
}

/** Mark a copied array seed dirty before its contents are changed. */
export function markValueContentFingerprintDirty(value: object): void {
  if (!Array.isArray(value)) {
    return;
  }
  const seed = arraySeedCache.get(value);
  if (seed) {
    seed.clean = false;
  }
  lineCache.delete(value);
}

/**
 * Rebase an array seed after deleting known source positions.
 *
 * The caller invokes this before splicing the target array, so the seed only
 * needs to become dirty here: the next hash derives the surviving child digests
 * by comparing identities against the anchor, which already covers descending
 * multi-index deletes. The signature stays stable for the transaction kernel.
 */
export function removeValueContentFingerprint(
  source: object,
  target: object,
  removedIndexes: readonly number[],
): void {
  if (removedIndexes.length === 0) {
    return;
  }
  const seed = arraySeedCache.get(source);
  if (!seed || !Array.isArray(target)) {
    return;
  }
  if (source === target) {
    seed.clean = false;
  } else {
    const anchored = Array.isArray(source) && seed.clean;
    arraySeedCache.set(target, {
      anchor: anchored ? (source as readonly unknown[]) : seed.anchor,
      hashes: seed.hashes,
      hash: seed.hash,
      checkpoints: seed.checkpoints,
      clean: false,
      partial: seed.partial,
    });
  }
  lineCache.delete(target);
}

/** Copy a line's immutable hash seeds onto its copy-on-write shell. */
export function inheritLineContentFingerprint(source: object, target: object): void {
  const seed = lineSeedCache.get(source);
  if (seed) {
    lineSeedCache.set(target, seed);
  }
}

/** Start state of an array digest: the opening frame plus the length word. */
function arrayFoldStart(length: number): number {
  return hashWord(hashText("["), length);
}

/** Close an array fold with the canonical closing frame. */
function arrayFoldEnd(state: number): number {
  return hashText("]", state);
}

/**
 * Fold known child digests `[start, end)` into a running array-hash state.
 *
 * Kept as its own small function so the hot re-fold after an edit stays
 * monomorphic; `end` may be shorter than the array when the fold resumes from a
 * checkpoint. Boundary states are recorded for later checkpoint reuse.
 */
function foldArrayHashes(
  hashes: readonly number[],
  start: number,
  end: number,
  state: number,
  checkpoints: number[],
): number {
  let next = state;
  for (let index = start; index < end; index += 1) {
    next = hashWord(next, hashes[index]);
    if ((index + 1) % ARRAY_BLOCK_SIZE === 0 && index + 1 < end) {
      checkpoints.push(next);
    }
  }
  return next;
}

/**
 * Reconcile a dirty array seed against the live array and return its digest.
 *
 * One identity scan finds the changed children, hashes only those, and re-folds
 * the suffix from the checkpoint before the first changed block (a changed
 * length seeds a fresh fold because the length word is part of the canonical
 * digest). Reusing the seed child digests keeps the walk free of per-child
 * `WeakMap` lookups, and the result always equals a cold walk.
 */
function reconcileArraySeed(
  seed: ArrayFingerprintSeed,
  value: readonly unknown[],
  ignoreIds: boolean,
  stack: WeakSet<object>,
  depth: number,
): number {
  const anchor = seed.anchor;
  const length = value.length;
  const anchorLength = anchor.length;
  if (length === anchorLength) {
    let hashes: (number | undefined)[] | null = null;
    let changedAt = length;
    for (let index = 0; index < length; index += 1) {
      if (anchor[index] === value[index]) {
        continue;
      }
      if (changedAt === length) {
        changedAt = index;
      }
      if (!hashes) {
        hashes = seed.hashes.slice();
      }
      hashes[index] = valueHash(value[index], ignoreIds, stack, depth + 1);
    }
    if (!hashes) {
      seed.anchor = value;
      seed.clean = true;
      return seed.hash;
    }
    if (seed.partial) {
      for (let index = 0; index < length; index += 1) {
        if (hashes[index] === undefined) {
          hashes[index] = valueHash(value[index], ignoreIds, stack, depth + 1);
        }
      }
    }
    const cachedCheckpoints = seed.checkpoints;
    const startBlock = Math.floor(changedAt / ARRAY_BLOCK_SIZE);
    const checkpoint = cachedCheckpoints?.[startBlock];
    const resumesFromCheckpoint = checkpoint !== undefined;
    const state = resumesFromCheckpoint ? checkpoint : arrayFoldStart(length);
    const checkpoints = resumesFromCheckpoint
      ? (cachedCheckpoints as readonly number[]).slice(0, startBlock + 1)
      : [state];
    const start = resumesFromCheckpoint ? startBlock * ARRAY_BLOCK_SIZE : 0;
    const hash = arrayFoldEnd(
      foldArrayHashes(hashes as readonly number[], start, length, state, checkpoints),
    );
    seed.anchor = value;
    seed.hashes = hashes;
    seed.hash = hash;
    seed.checkpoints = checkpoints;
    seed.clean = true;
    seed.partial = false;
    return hash;
  }
  // A changed length may combine appends, removals, and replaced children, so
  // rebuild the child-hash vector around the unchanged prefix and suffix.
  const shared = Math.min(anchorLength, length);
  let prefix = 0;
  while (prefix < shared && anchor[prefix] === value[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  const suffixLimit = shared - prefix;
  while (suffix < suffixLimit && anchor[anchorLength - 1 - suffix] === value[length - 1 - suffix]) {
    suffix += 1;
  }
  const hashes: number[] = [];
  for (let index = 0; index < prefix; index += 1) {
    hashes.push(seed.hashes[index] ?? valueHash(value[index], ignoreIds, stack, depth + 1));
  }
  const middleEnd = length - suffix;
  for (let index = prefix; index < middleEnd; index += 1) {
    hashes.push(valueHash(value[index], ignoreIds, stack, depth + 1));
  }
  const anchorSuffixStart = anchorLength - suffix;
  for (let index = 0; index < suffix; index += 1) {
    const position = middleEnd + index;
    hashes.push(
      seed.hashes[anchorSuffixStart + index] ??
        valueHash(value[position], ignoreIds, stack, depth + 1),
    );
  }
  const start = arrayFoldStart(length);
  const checkpoints: number[] = [start];
  const hash = arrayFoldEnd(foldArrayHashes(hashes, 0, length, start, checkpoints));
  seed.anchor = value;
  seed.hashes = hashes;
  seed.hash = hash;
  seed.checkpoints = checkpoints;
  seed.clean = true;
  seed.partial = false;
  return hash;
}

/** Hash a value with sorted object keys and cycle protection. */
function valueHash(
  value: unknown,
  ignoreIds: boolean,
  stack = new WeakSet<object>(),
  depth = 0,
  topLevelChildren?: Record<string, number>,
): number {
  if (value === null) {
    return hashText("null");
  }
  switch (typeof value) {
    case "number":
      return primitiveHash("number", numberText(value));
    case "string":
    case "boolean": {
      const text = JSON.stringify(value);
      return primitiveHash(typeof value, text);
    }
    case "bigint":
      return primitiveHash("bigint", value.toString());
    case "undefined":
    case "function":
    case "symbol":
      return primitiveHash("null", "null");
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
    if (topLevelChildren && depth === 0 && !Array.isArray(value)) {
      const cachedParts = linePartsCache.get(object);
      if (cachedParts) {
        for (const [key, childHash] of cachedParts) {
          topLevelChildren[key] = childHash;
        }
      } else {
        const record = value as Record<string, unknown>;
        const parts = new Map<string, number>();
        const seed = lineSeedCache.get(object);
        for (const key of sortedKeys(record)) {
          if (ignoreIds && key === "id") {
            continue;
          }
          const child = record[key];
          const kind = typeof child;
          if (child === undefined || kind === "function" || kind === "symbol") {
            continue;
          }
          const seeded = seed?.get(key);
          const childHash =
            seeded && seeded.value === child
              ? seeded.hash
              : valueHash(child, ignoreIds, new WeakSet<object>(), 1);
          parts.set(key, childHash);
          topLevelChildren[key] = childHash;
        }
        linePartsCache.set(object, parts);
      }
    }
    return cached;
  }
  let hash = hashText(Array.isArray(value) ? "[" : "{");
  stack.add(object);
  try {
    if (Array.isArray(value)) {
      const arraySeed = ignoreIds ? arraySeedCache.get(object) : undefined;
      if (arraySeed?.clean) {
        hash = arraySeed.hash;
      } else if (arraySeed) {
        hash = reconcileArraySeed(arraySeed, value, ignoreIds, stack, depth);
      } else {
        hash = hashWord(hash, value.length);
        const seedHashes =
          ignoreIds && value.length >= ARRAY_SEED_MIN_LENGTH ? ([] as number[]) : null;
        const checkpoints = seedHashes ? [hash] : null;
        for (let index = 0; index < value.length; index += 1) {
          const childHash = valueHash(value[index], ignoreIds, stack, depth + 1);
          if (seedHashes) {
            seedHashes.push(childHash);
          }
          hash = hashWord(hash, childHash);
          if (checkpoints && (index + 1) % ARRAY_BLOCK_SIZE === 0 && index + 1 < value.length) {
            checkpoints.push(hash);
          }
        }
        hash = arrayFoldEnd(hash);
        if (seedHashes && checkpoints) {
          arraySeedCache.set(object, {
            anchor: value,
            hashes: seedHashes,
            hash,
            checkpoints,
            clean: true,
            partial: false,
          });
        }
      }
    } else {
      const record = value as Record<string, unknown>;
      const parts = topLevelChildren && depth === 0 ? new Map<string, number>() : undefined;
      const seed =
        valueSeedCache.get(object) ?? (depth === 0 ? lineSeedCache.get(object) : undefined);
      for (const key of sortedKeys(record)) {
        if (ignoreIds && key === "id") {
          continue;
        }
        const child = record[key];
        const kind = typeof child;
        if (child === undefined || kind === "function" || kind === "symbol") {
          continue;
        }
        hash = hashText(key, hash);
        const seeded = seed?.get(key);
        const childHash =
          seeded && seeded.value === child
            ? seeded.hash
            : valueHash(child, ignoreIds, stack, depth + 1);
        if (parts) {
          parts.set(key, childHash);
          if (topLevelChildren) {
            topLevelChildren[key] = childHash;
          }
        }
        hash = hashWord(hash, childHash);
      }
      if (parts) {
        linePartsCache.set(object, parts);
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
