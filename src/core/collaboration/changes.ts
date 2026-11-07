/**
 * Object-addressed chart changes shared by the collaboration client and room
 * server.
 *
 * A change carries the value it expects to replace, so a server can apply
 * changes from different revisions without silently overwriting unrelated work.
 * Arrays whose items expose a stable `id` are addressed by that id; other arrays
 * stay atomic because their order or shape carries meaning.
 */

/** One address token: an object key, an array index, or a stable object id. */
type PathToken =
  | { readonly kind: "key"; readonly key: string }
  | { readonly kind: "index"; readonly index: number }
  | { readonly kind: "id"; readonly id: string };

/** One addressable set, add, or remove against a chart snapshot. */
export type ChartChange =
  | {
      readonly op: "set";
      readonly path: string;
      readonly before: unknown;
      readonly after: unknown;
    }
  | {
      readonly op: "add";
      readonly path: string;
      readonly after: unknown;
      /** Index in the resulting array when the parent is an id-addressed array. */
      readonly position?: number;
    }
  | {
      readonly op: "remove";
      readonly path: string;
      readonly before: unknown;
    };

/** Result of applying a batch: the new chart plus any conflicting paths. */
export interface ApplyChangesResult {
  readonly chart: unknown;
  /** Paths whose current value no longer matches the change's base. */
  readonly conflicts: readonly string[];
}

/** Whether a value is a plain object with named fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Whether a record owns a key with a defined value. */
function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key) && record[key] !== undefined;
}

/** Escape a JSON-pointer token. */
function escapeToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** Unescape a JSON-pointer token. */
function unescapeToken(value: string): string {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** Append one escaped pointer token to a path. */
function childPath(path: string, token: string): string {
  return `${path}/${escapeToken(token)}`;
}

/** Encode a stable object id as a path token. */
function idToken(id: string): string {
  return `$${escapeToken(id)}`;
}

/** Split a change path into its address tokens. The root path is empty. */
export function parsePath(path: string): PathToken[] {
  if (!path) {
    return [];
  }
  if (!path.startsWith("/")) {
    throw new Error(`Invalid change path: ${path}`);
  }
  return path
    .slice(1)
    .split("/")
    .map((raw) => {
      const token = unescapeToken(raw);
      if (token.startsWith("$") && token.length > 1) {
        return { kind: "id", id: token.slice(1) };
      }
      if (/^(0|[1-9]\d*)$/.test(token)) {
        return { kind: "index", index: Number(token) };
      }
      return { kind: "key", key: token };
    });
}

/** Number of address tokens in a path. */
function pathDepth(path: string): number {
  return parsePath(path).length;
}

/**
 * Canonical decimal text for one number.
 *
 * The text uses the shortest round-trip digits and the decimal/exponent
 * thresholds of ECMAScript `Number#toString`, then removes a positive
 * exponent's `+` so both room implementations emit the same spelling. Zero
 * (including negative zero) is `0`; NaN and infinities, which JSON cannot
 * carry, become `null`.
 */
export function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "null";
  }
  if (value === 0) {
    return "0";
  }
  return value.toString().replace("e+", "e");
}

/** Stable, opaque digest used to compare room snapshots without shipping a hash dependency. */
export function stableFingerprint(value: unknown): string {
  let hash = 0x811c9dc5;
  /** Feed text into the FNV-1a hash without building one large canonical string. */
  const feed = (text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  /** Serialize a value with sorted keys so equal snapshots hash equally. */
  const canonical = (input: unknown, stack: WeakSet<object>): void => {
    if (typeof input === "number") {
      feed(canonicalNumber(input));
      return;
    }
    if (input === null || typeof input !== "object") {
      feed(JSON.stringify(input) ?? "null");
      return;
    }
    const object = input as object;
    // Collaboration payloads come from another peer or an extension hook; a
    // back-reference must hash as a marker rather than overflow the stack.
    if (stack.has(object)) {
      feed('"\\u0000rpe-collab-cycle\\u0000"');
      return;
    }
    stack.add(object);
    try {
      if (Array.isArray(input)) {
        feed("[");
        for (let index = 0; index < input.length; index += 1) {
          if (index > 0) {
            feed(",");
          }
          // `map` skips holes; mirror that so sparse arrays hash as before.
          if (index in input) {
            canonical(input[index], stack);
          }
        }
        feed("]");
        return;
      }
      const record = input as Record<string, unknown>;
      feed("{");
      let first = true;
      for (const key of Object.keys(record)
        .filter((entry) => record[entry] !== undefined)
        .sort()) {
        if (!first) {
          feed(",");
        }
        first = false;
        feed(JSON.stringify(key));
        feed(":");
        canonical(record[key], stack);
      }
      feed("}");
    } finally {
      stack.delete(object);
    }
  };
  canonical(value, new WeakSet());
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Structural equality that ignores undefined fields and object key order. */
export function deepEqual(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, WeakSet<object>>(),
): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  const leftIsArray = Array.isArray(left);
  const rightIsArray = Array.isArray(right);
  if ((leftIsArray && rightIsArray) || (isRecord(left) && isRecord(right))) {
    // A pair already under comparison is a cycle in both graphs; treating it as
    // equal terminates instead of recursing forever. A failed comparison drops
    // the marker so a shared subtree compared elsewhere is not assumed equal.
    const leftObject = left as object;
    const rightObject = right as object;
    const visited = seen.get(leftObject);
    if (visited?.has(rightObject)) {
      return true;
    }
    const nextVisited = visited ?? new WeakSet<object>();
    nextVisited.add(rightObject);
    if (!visited) {
      seen.set(leftObject, nextVisited);
    }
    const equal = leftIsArray
      ? (left as readonly unknown[]).length === (right as readonly unknown[]).length &&
        (left as readonly unknown[]).every((value, index) =>
          deepEqual(value, (right as readonly unknown[])[index], seen),
        )
      : (() => {
          const leftRecord = left as Record<string, unknown>;
          const rightRecord = right as Record<string, unknown>;
          const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined);
          const rightKeys = Object.keys(rightRecord).filter(
            (key) => rightRecord[key] !== undefined,
          );
          return (
            leftKeys.length === rightKeys.length &&
            leftKeys.every(
              (key) =>
                Object.hasOwn(rightRecord, key) &&
                deepEqual(leftRecord[key], rightRecord[key], seen),
            )
          );
        })();
    if (!equal) {
      nextVisited.delete(rightObject);
    }
    return equal;
  }
  return false;
}

/** The shallow path grammar cannot need more; deeper graphs are malformed. */
const MAX_DIFF_DEPTH = 64;

/** Index an array by stable id, or null when any item lacks a unique id. */ function idMap(
  value: readonly unknown[],
): Map<string, Record<string, unknown>> | null {
  const result = new Map<string, Record<string, unknown>>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || result.has(item.id)) {
      return null;
    }
    result.set(item.id, item);
  }
  return result;
}

/** Whether two id-addressed arrays share the same relative order. */
function identicalOrder(left: readonly unknown[], right: readonly unknown[]): boolean {
  const leftIds = idMap(left);
  const rightIds = idMap(right);
  if (!leftIds || !rightIds) {
    return false;
  }
  const leftCommon = [...leftIds.keys()].filter((id) => rightIds.has(id));
  const rightCommon = [...rightIds.keys()].filter((id) => leftIds.has(id));
  return (
    leftCommon.length === rightCommon.length &&
    leftCommon.every((id, index) => id === rightCommon[index])
  );
}

/**
 * Describe `after` as changes against `before`.
 *
 * Object keys and id-addressed array items are diffed independently. A changed
 * array order or an array without stable ids becomes one atomic replacement.
 * A chart nested deeper than the cap becomes one atomic change: the path grammar
 * is shallow, so a deeper graph means malformed or cyclic data.
 */
export function diffCharts(before: unknown, after: unknown, path = "", depth = 0): ChartChange[] {
  if (depth > MAX_DIFF_DEPTH) {
    return [{ op: "set", path, before, after }];
  }
  if (deepEqual(before, after)) {
    return [];
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const beforeIds = idMap(before);
    const afterIds = idMap(after);
    if (beforeIds && afterIds && afterIds.size > 0) {
      if (!identicalOrder(before, after)) {
        return [{ op: "set", path, before, after }];
      }
      const changes: ChartChange[] = [];
      for (const id of beforeIds.keys()) {
        if (!afterIds.has(id)) {
          changes.push({
            op: "remove",
            path: childPath(path, idToken(id)),
            before: beforeIds.get(id),
          });
        }
      }
      for (const [index, id] of [...afterIds.keys()].entries()) {
        if (!beforeIds.has(id)) {
          changes.push({
            op: "add",
            path: childPath(path, idToken(id)),
            after: afterIds.get(id),
            position: index,
          });
        }
      }
      for (const [id, next] of afterIds) {
        const previous = beforeIds.get(id);
        if (previous) {
          changes.push(...diffCharts(previous, next, childPath(path, idToken(id)), depth + 1));
        }
      }
      return changes;
    }
    return [{ op: "set", path, before, after }];
  }
  if (isRecord(before) && isRecord(after)) {
    const changes: ChartChange[] = [];
    for (const key of Object.keys(before)) {
      if (!hasOwn(after, key)) {
        changes.push({ op: "remove", path: childPath(path, key), before: before[key] });
      }
    }
    for (const key of Object.keys(after)) {
      if (!hasOwn(before, key)) {
        changes.push({ op: "add", path: childPath(path, key), after: after[key] });
      } else if (!deepEqual(before[key], after[key])) {
        changes.push(...diffCharts(before[key], after[key], childPath(path, key), depth + 1));
      }
    }
    return changes;
  }
  return [{ op: "set", path, before, after }];
}

/** Resolve the container and final token for a non-root path. */
function resolveParent(
  root: unknown,
  tokens: readonly PathToken[],
): { parent: unknown; token: PathToken } | null {
  if (tokens.length === 0) {
    return null;
  }
  let current = root;
  for (const token of tokens.slice(0, -1)) {
    if (!isRecord(current) && !Array.isArray(current)) {
      return null;
    }
    if (token.kind === "key") {
      if (!isRecord(current) || !hasOwn(current, token.key)) {
        return null;
      }
      current = current[token.key];
    } else if (token.kind === "index") {
      if (!Array.isArray(current) || token.index >= current.length) {
        return null;
      }
      current = current[token.index];
    } else {
      if (!Array.isArray(current)) {
        return null;
      }
      const item = current.find((entry) => isRecord(entry) && entry.id === token.id);
      if (!item) {
        return null;
      }
      current = item;
    }
  }
  return { parent: current, token: tokens[tokens.length - 1] };
}

/** Read the value a final token addresses, or undefined when absent. */
function readAt(parent: unknown, token: PathToken): unknown {
  if (token.kind === "key") {
    return isRecord(parent) && hasOwn(parent, token.key) ? parent[token.key] : undefined;
  }
  if (token.kind === "index") {
    return Array.isArray(parent) && token.index < parent.length ? parent[token.index] : undefined;
  }
  if (!Array.isArray(parent)) {
    return undefined;
  }
  return parent.find((entry) => isRecord(entry) && entry.id === token.id);
}

const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/** Write a value at a token, inserting into arrays and refusing prototype keys. */
function writeAt(
  parent: unknown,
  token: PathToken,
  value: unknown,
  position?: number,
  replace = false,
): boolean {
  if (token.kind === "key") {
    if (!isRecord(parent) || UNSAFE_KEYS.has(token.key)) {
      return false;
    }
    parent[token.key] = value;
    return true;
  }
  if (token.kind === "index") {
    if (!Array.isArray(parent) || token.index > parent.length) {
      return false;
    }
    if (replace && token.index < parent.length) {
      parent[token.index] = value;
      return true;
    }
    parent.splice(token.index, 0, value);
    return true;
  }
  if (!Array.isArray(parent)) {
    return false;
  }
  const existing = parent.findIndex((entry) => isRecord(entry) && entry.id === token.id);
  if (existing >= 0) {
    if (!replace) {
      return false;
    }
    parent[existing] = value;
    return true;
  }
  const index =
    position === undefined ? parent.length : Math.max(0, Math.min(parent.length, position));
  parent.splice(index, 0, value);
  return true;
}

/** Remove the value a token addresses, returning whether anything was removed. */
function deleteAt(parent: unknown, token: PathToken): boolean {
  if (token.kind === "key") {
    if (!isRecord(parent) || !hasOwn(parent, token.key) || UNSAFE_KEYS.has(token.key)) {
      return false;
    }
    delete parent[token.key];
    return true;
  }
  if (token.kind === "index") {
    if (!Array.isArray(parent) || token.index >= parent.length) {
      return false;
    }
    parent.splice(token.index, 1);
    return true;
  }
  if (!Array.isArray(parent)) {
    return false;
  }
  const index = parent.findIndex((entry) => isRecord(entry) && entry.id === token.id);
  if (index < 0) {
    return false;
  }
  parent.splice(index, 1);
  return true;
}

/** Clone JSON-compatible data so a rejected batch cannot mutate its input. */
function cloneJson(value: unknown): unknown {
  return value === undefined ? value : structuredClone(value);
}

/** Clone one mutable container while retaining references to untouched children. */
function cloneContainer(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.slice();
  }
  return isRecord(value) ? { ...value } : null;
}

/** Copy the containers leading to a change, preserving unrelated chart subtrees. */
function clonePath(root: unknown, tokens: readonly PathToken[]): unknown {
  const clonedRoot = cloneContainer(root);
  if (clonedRoot === null) {
    return root;
  }
  let original: unknown = root;
  let copy: unknown = clonedRoot;
  for (const token of tokens.slice(0, -1)) {
    const child = readAt(original, token);
    const clonedChild = cloneContainer(child);
    if (clonedChild === null || !writeAt(copy, token, clonedChild, undefined, true)) {
      return root;
    }
    original = child;
    copy = clonedChild;
  }
  return clonedRoot;
}

/** Options for `applyChartChanges`. */
export interface ApplyChangesOptions {
  /**
   * Last-writer-wins mode used by encrypted rooms. The server cannot inspect
   * encrypted values, so clients apply the ordered batch even when a field's
   * base moved. Paths that no longer exist are ignored.
   */
  readonly force?: boolean;
}

/**
 * Apply changes atomically. Any stale base or malformed path rejects the whole
 * batch, so callers never see a half-applied chart.
 */
export function applyChartChanges(
  chart: unknown,
  changes: readonly ChartChange[],
  options: ApplyChangesOptions = {},
): ApplyChangesResult {
  const force = options.force === true;
  let next = cloneContainer(chart) ?? chart;
  const conflicts: string[] = [];
  // Parents before children; an atomic replacement makes descendants irrelevant.
  const ordered = [...changes].sort((left, right) => pathDepth(left.path) - pathDepth(right.path));
  const replaced = new Set<string>();
  for (const change of ordered) {
    if ([...replaced].some((path) => change.path.startsWith(`${path}/`))) {
      continue;
    }
    let tokens: PathToken[];
    try {
      tokens = parsePath(change.path);
    } catch {
      if (!force) {
        conflicts.push(change.path);
      }
      continue;
    }
    if (tokens.length === 0) {
      if (change.op !== "set" || (!force && !deepEqual(next, change.before))) {
        if (!force) {
          conflicts.push(change.path);
        }
        continue;
      }
      next = cloneJson(change.after);
      replaced.add(change.path);
      continue;
    }
    const target = resolveParent(next, tokens);
    if (!target) {
      if (!force) {
        conflicts.push(change.path);
      }
      continue;
    }
    const current = readAt(target.parent, target.token);
    if (change.op === "set") {
      if (!force && !deepEqual(current, change.before)) {
        conflicts.push(change.path);
        continue;
      }
      const isolated = clonePath(next, tokens);
      const isolatedTarget = resolveParent(isolated, tokens);
      if (
        !isolatedTarget ||
        !writeAt(
          isolatedTarget.parent,
          isolatedTarget.token,
          cloneJson(change.after),
          undefined,
          true,
        )
      ) {
        if (!force) {
          conflicts.push(change.path);
        }
        continue;
      }
      next = isolated;
      replaced.add(change.path);
      continue;
    }
    if (change.op === "add") {
      if (current !== undefined && !force) {
        conflicts.push(change.path);
        continue;
      }
      const isolated = clonePath(next, tokens);
      const isolatedTarget = resolveParent(isolated, tokens);
      if (
        !isolatedTarget ||
        (!writeAt(
          isolatedTarget.parent,
          isolatedTarget.token,
          cloneJson(change.after),
          change.position,
          force,
        ) &&
          !force)
      ) {
        conflicts.push(change.path);
        continue;
      }
      next = isolated;
      continue;
    }
    if (!force && !deepEqual(current, change.before)) {
      conflicts.push(change.path);
      continue;
    }
    const isolated = clonePath(next, tokens);
    const isolatedTarget = resolveParent(isolated, tokens);
    if (!isolatedTarget || !deleteAt(isolatedTarget.parent, isolatedTarget.token)) {
      if (!force) {
        conflicts.push(change.path);
      }
      continue;
    }
    next = isolated;
  }
  if (conflicts.length) {
    return { chart, conflicts };
  }
  return { chart: next, conflicts: [] };
}

/** Rebuild the root value for a root replacement, or return null when absent. */
export function rootChange(changes: readonly ChartChange[]): ChartChange | null {
  return changes.find((change) => change.path === "" && change.op === "set") ?? null;
}

/** Lock scopes a set of changes needs. */
export interface ChangeLockKeys {
  /** The change touches chart-wide state. */
  readonly chart: boolean;
  /** Line ids involved in a property/topology change. */
  readonly lines: readonly string[];
  /** Note/event objects involved in a content change. */
  readonly objects: readonly string[];
  /** The narrowest keys a cooperative client should acquire before sending. */
  readonly acquire: readonly string[];
}

/**
 * Derive lock scopes from change paths. A line-level change owns `line:<id>`;
 * note/event edits own `obj:<id>` so different objects can proceed in parallel.
 */
export function changeLockKeys(changes: readonly ChartChange[]): ChangeLockKeys {
  let chart = false;
  const lines = new Set<string>();
  const objects = new Set<string>();
  const acquire = new Set<string>();
  for (const change of changes) {
    let tokens: PathToken[];
    try {
      tokens = parsePath(change.path);
    } catch {
      chart = true;
      acquire.add("chart");
      continue;
    }
    if (tokens.length === 0 || tokens[0].kind !== "key" || tokens[0].key !== "judgeLineList") {
      chart = true;
      acquire.add("chart");
      continue;
    }
    const line = tokens[1];
    if (!line || line.kind !== "id") {
      chart = true;
      acquire.add("chart");
      continue;
    }
    const lineKey = `line:${line.id}`;
    lines.add(lineKey);
    const isObjectChange =
      tokens[2]?.kind === "key" &&
      (tokens[2].key === "notes" || tokens[2].key === "eventLayers") &&
      tokens.length > 3;
    if (isObjectChange) {
      const object = tokens[3];
      if (object?.kind === "id") {
        const objectKey = `obj:${object.id}`;
        objects.add(objectKey);
        acquire.add(objectKey);
      } else {
        acquire.add(lineKey);
      }
    } else {
      // Adding/removing a line changes parent indices; treat topology as
      // chart-wide. A property edit only needs the line lock.
      if (change.op !== "set") {
        chart = true;
        acquire.add("chart");
      } else {
        acquire.add(lineKey);
      }
    }
  }
  return {
    chart,
    lines: Object.freeze([...lines]),
    objects: Object.freeze([...objects]),
    acquire: Object.freeze([...acquire]),
  };
}
