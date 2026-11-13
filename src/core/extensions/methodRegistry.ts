/**
 * The Extension method registry and its completeness check.
 *
 * Every method reachable from the capability-gated `context.api` facade is
 * listed here with the capability that grants it, its consent risk tier, and
 * whether it writes host-owned state. The gate, consent UI, and documentation
 * read this table instead of discovering methods by reflection.
 *
 * The registry is deliberately static: a new facade method is not reachable to
 * a package until it is added here, and `assertRegistryComplete` turns a
 * missing registration into a stable `methodNotRegistered` error with a path.
 */
import type { ReduxApi } from "../api/index.ts";
import { isExtensionCapability, type ExtensionCapability } from "./capabilities.ts";

/** Consent risk tier shown for one callable Extension method. */
export type ExtensionMethodRisk = "read" | "write" | "sensitive";

/** One externally callable Extension API method. */
export interface ExtensionMethodEntry {
  /** Capability that grants the handle (and thus the method). */
  readonly capability: ExtensionCapability;
  /** Facade handle name, or an empty string for a `context.*` method. */
  readonly handle: string;
  /** Method name on the handle; nested namespaces use dot-separated paths. */
  readonly method: string;
  /** Human-facing risk tier used by the consent dialog. */
  readonly risk: ExtensionMethodRisk;
  /** Host version that introduced this entry, for future compatibility gates. */
  readonly since: string;
  /** True when a host-mediated call changes durable chart, document, or registry state. */
  readonly writesHostState: boolean;
}

/** Stable error code carried by a missing method registration. */
export type ExtensionMethodRegistrationCode = "methodNotRegistered";

/**
 * Thrown when the facade exposes a method the registry does not know.
 *
 * This is a host defect rather than a package fault, so the caller may surface
 * it independently from `capabilityDenied` and keep the path for diagnostics.
 */
export class ExtensionMethodRegistrationError extends Error {
  readonly code: ExtensionMethodRegistrationCode = "methodNotRegistered";
  readonly path: string;

  /** Build the error for one missing `handle.method` path. */
  constructor(path: string) {
    super(`Extension method is not registered: ${path}`);
    this.name = "ExtensionMethodRegistrationError";
    this.path = path;
  }
}

/** The first host major that published the current Extension facade. */
const REGISTRY_SINCE = "1.0.0";

/** Facade handles that `gateExtensionApi` can expose to a package. */
type FacadeHandle =
  | "chart"
  | "transaction"
  | "selection"
  | "document"
  | "library"
  | "playback"
  | "toolbar"
  | "sidebar"
  | "contextMenu"
  | "settings"
  | "values"
  | "shortcuts"
  | "diagnostics"
  | "hitTest"
  | "preview"
  | "layout"
  | "theme"
  | "help";

/** Function-valued keys of one object type. */
type FunctionMethod<T> = Extract<
  {
    [K in keyof T]-?: T[K] extends (...args: never[]) => unknown ? K : never;
  }[keyof T],
  string
>;

/** Paths through a one-level method namespace such as `values.byId` or `preview.subscribe`. */
type NamespaceMethodPath<T> = {
  [K in keyof T]-?: T[K] extends (...args: never[]) => unknown
    ? never
    : T[K] extends object
      ? `${Extract<K, string>}.${FunctionMethod<T[K]>}`
      : never;
}[keyof T];

/** Every callable path on one facade handle, including one-level namespaces. */
type FacadeMethodPath<H extends FacadeHandle> = H extends keyof ReduxApi
  ? FunctionMethod<ReduxApi[H]> | NamespaceMethodPath<ReduxApi[H]>
  : never;

/** One seed tuple: method path, capability, risk, and host-state effect. */
type MethodSeed = readonly [
  method: string,
  capability: ExtensionCapability,
  risk: ExtensionMethodRisk,
  writesHostState: boolean,
];

/** The handle table is checked against the public facade types at compile time. */
type HandleSeedTable = {
  readonly [H in FacadeHandle]: readonly (readonly [
    method: FacadeMethodPath<H>,
    capability: ExtensionCapability,
    risk: ExtensionMethodRisk,
    writesHostState: boolean,
  ])[];
};

/**
 * Methods reachable through `context.api`, grouped by facade handle.
 *
 * `transaction`, the document/library write methods, and asset writes check
 * their own capability inside the gated view even when the handle itself was
 * granted through a read capability. Project-bound library methods share the
 * names and capabilities registered for the scoped project handle.
 */
const HANDLE_METHODS = {
  chart: [
    ["availability", "chart.read", "read", false],
    ["state", "chart.read", "read", false],
    ["read", "chart.read", "read", false],
    ["snapshot", "chart.read", "read", false],
    ["metadata", "chart.read", "read", false],
    ["resources", "chart.read", "read", false],
    ["lines", "chart.read", "read", false],
    ["line", "chart.read", "read", false],
    ["parentId", "chart.read", "read", false],
    ["notes", "chart.read", "read", false],
    ["note", "chart.read", "read", false],
    ["events", "chart.read", "read", false],
    ["event", "chart.read", "read", false],
  ],
  transaction: [
    ["availability", "chart.write", "read", false],
    ["apply", "chart.write", "write", true],
    ["preview", "chart.write", "read", false],
    ["cancel", "chart.write", "write", false],
    ["history", "chart.write", "read", false],
    ["undo", "chart.write", "write", true],
    ["redo", "chart.write", "write", true],
  ],
  selection: [
    ["availability", "selection.read", "read", false],
    ["state", "selection.read", "read", false],
    ["subscribe", "selection.read", "read", false],
    ["clear", "selection.write", "write", true],
    ["copy", "selection.write", "write", true],
    ["cut", "selection.write", "write", true],
    ["delete", "selection.write", "write", true],
    ["paste", "selection.write", "write", true],
    ["notes.select", "selection.write", "write", true],
    ["notes.range", "selection.write", "write", true],
    ["events.select", "selection.write", "write", true],
    ["events.range", "selection.write", "write", true],
  ],
  document: [
    ["availability", "document.read", "read", false],
    ["state", "document.read", "read", false],
    ["create", "document.write", "sensitive", true],
    ["openPath", "document.write", "sensitive", true],
    ["openBytes", "document.write", "sensitive", true],
    ["save", "document.write", "sensitive", true],
    ["close", "document.write", "sensitive", true],
  ],
  library: [
    ["availability", "library.read", "read", false],
    ["list", "library.read", "read", false],
    ["scope", "library.read", "read", false],
    ["create", "library.write", "sensitive", true],
    ["createRaw", "library.write", "sensitive", true],
    ["current.get", "library.read", "read", false],
    ["current.update", "library.write", "sensitive", true],
    ["current.remove", "library.write", "sensitive", true],
    ["current.duplicate", "library.write", "sensitive", true],
    ["current.assets", "library.read", "read", false],
    ["current.asset", "library.read", "read", false],
    ["current.addAsset", "assets.write", "sensitive", true],
    ["current.removeAsset", "assets.write", "sensitive", true],
    ["current.revisions", "library.read", "read", false],
    ["current.createRevision", "library.write", "sensitive", true],
    ["current.revision", "library.read", "read", false],
    ["current.removeRevision", "library.write", "sensitive", true],
  ],
  playback: [
    ["availability", "playback.read", "read", false],
    ["state", "playback.read", "read", false],
    ["play", "playback.control", "write", false],
    ["pause", "playback.control", "write", false],
    ["stop", "playback.control", "write", false],
    ["replay", "playback.control", "write", false],
    ["seek", "playback.control", "write", false],
    ["seekBeat", "playback.control", "write", false],
    ["setRate", "playback.control", "write", false],
    ["inspect", "playback.read", "read", false],
    ["renderAt", "playback.control", "write", false],
    ["textures", "playback.read", "read", false],
    ["frames", "playback.read", "read", false],
    ["startMeasurement", "playback.control", "write", false],
    ["stopMeasurement", "playback.control", "write", false],
    ["metrics", "playback.read", "read", false],
    ["resetDiagnostics", "playback.control", "write", false],
  ],
  toolbar: [
    ["register", "ui.toolbar", "write", true],
    ["unregister", "ui.toolbar", "write", true],
    ["get", "ui.toolbar", "read", false],
    ["subscribe", "ui.toolbar", "read", false],
    ["entry", "ui.toolbar", "read", false],
    ["refresh", "ui.toolbar", "write", false],
    ["available", "ui.toolbar", "read", false],
    ["bindings", "ui.toolbar", "read", false],
    ["shortcutText", "ui.toolbar", "read", false],
  ],
  sidebar: [
    ["register", "ui.sidebar", "write", true],
    ["unregister", "ui.sidebar", "write", true],
    ["registerDivider", "ui.sidebar", "write", true],
    ["registerAll", "ui.sidebar", "write", true],
    ["open", "ui.sidebar", "write", false],
    ["close", "ui.sidebar", "write", false],
    ["get", "ui.sidebar", "read", false],
    ["subscribe", "ui.sidebar", "read", false],
    ["entry", "ui.sidebar", "read", false],
  ],
  contextMenu: [
    ["register", "ui.contextMenu", "write", true],
    ["registerAll", "ui.contextMenu", "write", true],
    ["update", "ui.contextMenu", "write", true],
    ["unregister", "ui.contextMenu", "write", true],
    ["get", "ui.contextMenu", "read", false],
    ["subscribe", "ui.contextMenu", "read", false],
    ["entry", "ui.contextMenu", "read", false],
  ],
  settings: [
    ["registerNavigation", "settings", "write", true],
    ["registerSetting", "settings", "write", true],
  ],
  values: [
    ["define", "values", "write", true],
    ["getHandle", "values", "read", false],
    ["byId.has", "values", "read", false],
    ["byId.ownerOf", "values", "read", false],
    ["byId.get", "values", "read", false],
    ["byId.set", "values", "write", true],
    ["byId.update", "values", "write", true],
    ["byId.subscribe", "values", "read", false],
    ["byId.subscribeAll", "values", "read", false],
    ["byId.snapshot", "values", "read", false],
  ],
  shortcuts: [
    ["registerCategory", "shortcuts", "write", true],
    ["registerShortcut", "shortcuts", "write", true],
  ],
  diagnostics: [
    ["snapshot", "diagnostics", "read", false],
    ["trace.enabled", "diagnostics", "read", false],
    ["trace.setEnabled", "diagnostics", "write", false],
    ["trace.clear", "diagnostics", "write", false],
  ],
  hitTest: [
    ["availability", "preview.read", "read", false],
    ["pick", "preview.read", "read", false],
    ["queryAt", "hitTest.read", "read", false],
    ["geometry", "preview.read", "read", false],
  ],
  preview: [
    ["availability", "preview.read", "read", false],
    ["snapshot", "preview.read", "read", false],
    ["frame", "preview.read", "read", false],
    ["subscribe", "preview.read", "read", false],
  ],
  layout: [
    ["availability", "preview.read", "read", false],
    ["anchors", "preview.read", "read", false],
  ],
  theme: [
    ["tokens", "styles", "read", false],
    ["subscribe", "styles", "read", false],
  ],
  help: [
    ["availability", "ui.guide", "read", false],
    ["openChangelog", "ui.guide", "write", false],
    ["openGuide", "ui.guide", "write", false],
    ["registerTutorial", "ui.guide", "write", true],
  ],
} as const satisfies HandleSeedTable;

/** Context methods that do not pass through the gated facade. */
type ContextMethodPath =
  | "events.on"
  | "hooks.register"
  | "hooks.invoke"
  | "scripts.register"
  | `settings.${"get" | "set" | "delete" | "clear"}`
  | `storage.${"get" | "set" | "delete" | "clear" | "getJSON" | "setJSON"}`
  | `timers.${"setTimeout" | "setInterval" | "requestAnimationFrame" | "clearTimeout" | "clearInterval" | "cancelAnimationFrame"}`
  | "styles.add"
  | `ui.${"notice" | "confirm" | "progress" | "input" | "select" | "guide" | "designCatalog" | "registerDesignPanel" | "registerPanel" | "registerSidebar" | "registerOverlay"}`;

/** Context seeds carry an already namespaced method path and an empty handle. */
const CONTEXT_METHODS = [
  ["events.on", "events", "read", false],
  ["hooks.register", "hooks", "write", true],
  ["hooks.invoke", "hooks", "write", false],
  ["scripts.register", "scripts", "write", true],
  ["settings.get", "settings", "read", false],
  ["settings.set", "settings", "write", true],
  ["settings.delete", "settings", "write", true],
  ["settings.clear", "settings", "write", true],
  ["storage.get", "storage", "read", false],
  ["storage.set", "storage", "write", true],
  ["storage.delete", "storage", "write", true],
  ["storage.clear", "storage", "write", true],
  ["storage.getJSON", "storage", "read", false],
  ["storage.setJSON", "storage", "write", true],
  ["timers.setTimeout", "timers", "write", false],
  ["timers.setInterval", "timers", "write", false],
  ["timers.requestAnimationFrame", "timers", "write", false],
  ["timers.clearTimeout", "timers", "write", false],
  ["timers.clearInterval", "timers", "write", false],
  ["timers.cancelAnimationFrame", "timers", "write", false],
  ["styles.add", "styles", "write", true],
  ["ui.notice", "ui.notice", "write", false],
  ["ui.progress", "ui.notice", "write", false],
  ["ui.confirm", "ui.dialog", "sensitive", false],
  ["ui.input", "ui.dialog", "sensitive", false],
  ["ui.select", "ui.dialog", "sensitive", false],
  ["ui.guide", "ui.dialog", "sensitive", false],
  ["ui.designCatalog", "ui.panel", "read", false],
  ["ui.registerDesignPanel", "ui.panel", "write", true],
  ["ui.registerPanel", "ui.panel", "write", true],
  ["ui.registerSidebar", "ui.sidebar", "write", true],
  ["ui.registerOverlay", "ui.overlay", "write", true],
] as const satisfies readonly (readonly [
  method: ContextMethodPath,
  capability: ExtensionCapability,
  risk: ExtensionMethodRisk,
  writesHostState: boolean,
])[];

/** Build registry entries for one handle from compact seed tuples. */
function toEntries(handle: string, seeds: readonly MethodSeed[]): ExtensionMethodEntry[] {
  return seeds.map(([method, capability, risk, writesHostState]) =>
    Object.freeze({
      capability,
      handle,
      method,
      risk,
      since: REGISTRY_SINCE,
      writesHostState,
    }),
  );
}

const HANDLE_ENTRIES = (Object.keys(HANDLE_METHODS) as FacadeHandle[]).flatMap((handle) =>
  toEntries(handle, HANDLE_METHODS[handle] as unknown as readonly MethodSeed[]),
);

const CONTEXT_ENTRIES = toEntries("", CONTEXT_METHODS as unknown as readonly MethodSeed[]);

/** Every method a package may reach, including the consent-only `context.*` entries. */
export const EXTENSION_METHODS: readonly ExtensionMethodEntry[] = Object.freeze([
  ...HANDLE_ENTRIES,
  ...CONTEXT_ENTRIES,
]);

/** Method names that would create a universal entry point or escape the sandbox. */
const FORBIDDEN_PATH =
  /(^|[._])(?:host|patch|eval|exec|raw|internal|shell|fs|ipc|network)([._]|$)/u;

/** Fail fast when the static table violates its own contract. */
function assertRegistryInvariants(entries: readonly ExtensionMethodEntry[]): void {
  const keys = new Set<string>();
  for (const entry of entries) {
    const key = methodKey(entry.handle, entry.method);
    if (keys.has(key)) {
      throw new Error(`Duplicate Extension method registration: ${key}`);
    }
    keys.add(key);
    if (!isExtensionCapability(entry.capability) || entry.capability === "host.patch") {
      throw new Error(`Extension method has an ungrantable capability: ${key}`);
    }
    if (FORBIDDEN_PATH.test(key)) {
      throw new Error(`Extension method name is forbidden: ${key}`);
    }
    if (entry.writesHostState && entry.risk === "read") {
      throw new Error(`A read method cannot write host state: ${key}`);
    }
    if (!entry.since) {
      throw new Error(`Extension method has no since version: ${key}`);
    }
  }
}

assertRegistryInvariants(EXTENSION_METHODS);

const METHOD_INDEX: ReadonlyMap<string, ExtensionMethodEntry> = new Map(
  EXTENSION_METHODS.map((entry) => [methodKey(entry.handle, entry.method), entry]),
);

/**
 * Build the stable lookup key for one method.
 *
 * `context.*` entries use an empty handle because they do not pass through the
 * facade; their method name already carries the namespace (`ui.notice`).
 */
export function methodKey(handle: string, method: string): string {
  return handle ? `${handle}.${method}` : method;
}

/** Look up one registered method, or undefined when the host forgot to register it. */
export function lookupMethod(handle: string, method: string): ExtensionMethodEntry | undefined {
  return METHOD_INDEX.get(methodKey(handle, method));
}

/** Every method granted by one capability, in registry order. */
export function methodsForCapability(
  capability: ExtensionCapability,
): readonly ExtensionMethodEntry[] {
  return Object.freeze(EXTENSION_METHODS.filter((entry) => entry.capability === capability));
}

/** Read one facade member without letting a denied getter abort the walk. */
function readMember(container: Readonly<Record<string, unknown>>, key: string): unknown {
  try {
    return container[key];
  } catch {
    return undefined;
  }
}

/** Whether a value is a non-array object. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether an object is a pure method namespace such as `values.byId`. */
function isMethodNamespace(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => typeof readMember(value, key) === "function");
}

/** Throw when one facade path has no registry entry. */
function requireRegistered(handle: string, method: string): void {
  const path = methodKey(handle, method);
  if (!METHOD_INDEX.has(path)) {
    throw new ExtensionMethodRegistrationError(path);
  }
}

/**
 * Verify that every method reachable through a facade is registered.
 *
 * The walk follows own enumerable keys, recurses into pure method namespaces
 * (`values.byId`, `selection.notes`, `diagnostics.trace`), and skips data
 * properties and denied handles. The first unregistered path fails with
 * `ExtensionMethodRegistrationError`.
 */
export function assertRegistryComplete(facade: Readonly<Record<string, object>>): void {
  const handles = facade as Readonly<Record<string, unknown>>;
  for (const handle of Object.keys(handles)) {
    const value = readMember(handles, handle);
    if (!isRecord(value)) {
      continue;
    }
    for (const member of Object.keys(value)) {
      const method = readMember(value, member);
      if (typeof method === "function") {
        requireRegistered(handle, member);
        continue;
      }
      if (isMethodNamespace(method)) {
        for (const nested of Object.keys(method)) {
          requireRegistered(handle, `${member}.${nested}`);
        }
      }
    }
  }
}
