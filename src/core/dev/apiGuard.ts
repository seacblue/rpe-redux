/**
 * Developer-only guard for a public API facade.
 *
 * The guard rebuilds the facade as plain guarded objects: it cannot be a Proxy
 * because `redux` is frozen and the Proxy invariants would reject wrapped
 * values for non-writable properties. Every call reports a deprecated path,
 * caught errors, and failed result envelopes, then returns the original value.
 */
import { devInspectResult, devReportDeprecatedApi, devReportError } from "./checks.ts";
import { DEPRECATED_API } from "./deprecations.generated.ts";

/** Read the replacement guidance for one facade path, if it is deprecated. */
export function devDeprecationFor(path: string): string | null {
  return DEPRECATED_API[path] ?? null;
}

/** Report a deprecated call made through a path the caller already knows. */
export function reportDevApiCall(path: string): void {
  const replacement = devDeprecationFor(path);
  if (replacement) {
    devReportDeprecatedApi(path, replacement);
  }
}

/** Report a caught error from a bridged call. */
export function reportDevApiError(path: string, error: unknown, detail?: string): void {
  devReportError(path, error, detail);
}

/** Inspect a bridged result envelope before it is returned to the caller. */
export function inspectDevApiResult(path: string, value: unknown, detail?: string): void {
  devInspectResult(path, value, detail);
}

/** Whether a result is a thenable without assuming a particular Promise realm. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return Boolean(
    value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function",
  );
}

/** Wrap one function so every call reports its developer-visible outcome. */
function guardFunction(fn: (...args: unknown[]) => unknown, path: string) {
  return function guardedApiMethod(this: unknown, ...args: unknown[]): unknown {
    reportDevApiCall(path);
    try {
      const result = fn.apply(this, args);
      if (isThenable(result)) {
        return Promise.resolve(result).then(
          (settled) => {
            inspectDevApiResult(path, settled);
            return settled;
          },
          (error: unknown) => {
            reportDevApiError(path, error);
            throw error;
          },
        );
      }
      inspectDevApiResult(path, result);
      return result;
    } catch (error) {
      reportDevApiError(path, error);
      throw error;
    }
  };
}

/**
 * Guarded values by source object and facade path.
 *
 * The path is part of the key because one object can be published under more
 * than one handle. Caching also preserves identity for repeated reads such as
 * `redux.chart`, which is what keeps every later call guarded.
 */
type GuardCache = WeakMap<object, Map<string, unknown>>;

/** Rebuild one object tree, wrapping every method and nested namespace. */
function guardValue(value: unknown, path: string, cache: GuardCache): unknown {
  const isFunction = typeof value === "function";
  if (!isFunction && (!value || typeof value !== "object" || Array.isArray(value))) {
    return value;
  }
  const source = value as object;
  let paths = cache.get(source);
  if (!paths) {
    paths = new Map();
    cache.set(source, paths);
  }
  const cached = paths.get(path);
  if (cached) {
    return cached;
  }
  if (isFunction) {
    const guarded = guardFunction(value as (...args: unknown[]) => unknown, path);
    paths.set(path, guarded);
    return guarded;
  }

  const guarded: Record<string, unknown> = {};
  paths.set(path, guarded);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) {
      continue;
    }
    const memberPath = path ? `${path}.${key}` : key;
    if ("value" in descriptor) {
      const member = descriptor.value;
      Object.defineProperty(guarded, key, {
        enumerable: true,
        configurable: true,
        get: () => guardValue(member, memberPath, cache),
      });
      continue;
    }
    if (descriptor.get) {
      const getter = descriptor.get;
      Object.defineProperty(guarded, key, {
        enumerable: true,
        configurable: true,
        get: () => guardValue(getter.call(value), memberPath, cache),
      });
    }
  }
  return guarded;
}

/** Build a guarded copy of a facade for the development server and debug builds. */
export function guardDevFacade<T extends object>(facade: T): T {
  return guardValue(facade, "", new WeakMap()) as T;
}
