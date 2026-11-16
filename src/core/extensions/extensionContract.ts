/**
 * Vocabulary shared by the Extension runtime, its persistence layer, and the
 * public facade. Types only: no behaviour and no host access live here.
 */
import type { ReduxApi } from "../api/index.ts";
import type { ExtensionCallback, ExtensionDisposer } from "./registry.ts";
import type { ExtensionScriptDefinition, ScriptUiContext } from "./scripts.ts";
import type { ExtensionI18n, ExtensionText, ExtensionTranslations } from "./i18n.ts";
import type { ExtensionScriptStep } from "./steps.ts";
import type { ExtensionParameterSchema } from "./parameters.ts";
import type { ExtensionCapability } from "./capabilities.ts";
import type {
  PublicHookHandler,
  PublicHookInvokeOptions,
  PublicHookInvocationResult,
  PublicHookPayloadSchema,
} from "./publicHooks.ts";
import type {
  ExtensionDataInfo,
  ExtensionDataProviderDefinition,
  ExtensionServiceDefinition,
  ExtensionServiceInfo,
} from "./serviceRegistry.ts";

/** Where the host found this package. A host fact, never a manifest field. */
export type ExtensionSource =
  "bundled" | "resource" | "source" | "portable" | "installed" | "imported";

/** Derived from the manifest shape: an `entry` means code, its absence means data. */
export type ExtensionContent = "code" | "data-only";

/** Declares how an Extension's behaviour relates to a collaboration room. */
export type ExtensionCollaborationMode = "local" | "chart" | "shared-service";

/** Host-computed trust for the bytes currently on disk. A package cannot declare it. */
export type ExtensionTrustState = "builtin" | "local-trusted" | "external-pending" | "blocked";

/** Whether the stored consent still applies to the current bytes. */
export type ExtensionConsent = "none" | "current" | "stale";

/** Author-declared provenance. Metadata only; it grants no trust. */
export interface ExtensionProvenance {
  sourceUrl?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  author?: string;
}

/** One host-owned recipe in a data-only package. */
export interface DeclarativeExtensionScript {
  /** Local id, unique inside the package. */
  id: string;
  label?: ExtensionText;
  description?: ExtensionText;
  parameters?: ExtensionParameterSchema;
  steps: readonly ExtensionScriptStep[];
}

/** A package manifest as declared on disk, before the host materialises a name. */
export interface TrustedExtensionManifest {
  id: string;
  name?: string;
  version: string;
  /**
   * `"extension"` and the deprecated `"mod"` alias are generic and keep working
   * for both package shapes. `"data-only"` requires declarative scripts and no
   * entry; `"script"` requires an entry module.
   */
  kind?: "extension" | "mod" | "data-only" | "script";
  /**
   * The host versions this package supports. A numeric value compares the host
   * major; a string is a semver range over the full host version.
   */
  engines: { "rpe-redux": number | string };
  entry?: string;
  i18n?: string;
  capabilities?: readonly ExtensionCapability[];
  /** Built-in-only declaration that the package tolerates paged chart facades. */
  pagedChartSafe?: boolean;
  /**
   * Collaboration scope. `local` is the default; `chart` affects shared chart
   * state through ordinary transactions; `shared-service` requires the same
   * package to be installed on peers that use that feature. Packages are never
   * transferred or executed by the room server.
   */
  collaboration?: ExtensionCollaborationMode;
  translations?: ExtensionTranslations;
  /** Optional provenance; validated for shape, never treated as trust. */
  sourceUrl?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  author?: string;
  dependencies?: readonly string[];
  conflicts?: readonly string[];
  /** Optional data-only recipes; each registers its own script. */
  scripts?: readonly DeclarativeExtensionScript[];
}

/** A manifest with a guaranteed display name, as handed to a package. */
export type MaterializedExtensionManifest = TrustedExtensionManifest & { name: string };

/** One owner-scoped string store backing the `settings` and `storage` handles. */
export interface ExtensionKeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
  clear(): void;
}

/**
 * The storage handle's JSON view over the same owner-scoped string entries.
 *
 * `getJSON` returns null for a missing key or unparseable stored text;
 * `setJSON` accepts only JSON data under the same 256 KB value bound as `set`.
 */
export interface ExtensionJsonStore extends ExtensionKeyValueStore {
  getJSON<T = unknown>(key: string): T | null;
  setJSON(key: string, value: unknown): void;
}

/** Host sink for a package's stylesheet contribution. */
export interface ExtensionStyleHost {
  add(cssText: string, owner: string): ExtensionDisposer;
}

/** Host timer implementation handed to a package; handles are disposed with it. */
export interface ExtensionTimerHost {
  setTimeout(callback: () => void, delay: number): ReturnType<typeof globalThis.setTimeout>;
  setInterval(callback: () => void, delay: number): ReturnType<typeof globalThis.setInterval>;
  requestAnimationFrame?(callback: FrameRequestCallback): number;
  clearTimeout?(handle: ReturnType<typeof globalThis.setTimeout>): void;
  clearInterval?(handle: ReturnType<typeof globalThis.setInterval>): void;
  cancelAnimationFrame?(handle: number): void;
}

/** The host handles a trusted package receives and owns until disposal. */
export interface ExtensionHostContext {
  readonly manifest: MaterializedExtensionManifest;
  readonly signal: AbortSignal;
  /** The complete public Redux facade, including editor availability seams. */
  readonly api: ReduxApi;
  readonly i18n: ExtensionI18n;
  readonly ui: ScriptUiContext;
  readonly events: {
    on(name: string, callback: ExtensionCallback<unknown>, priority?: number): ExtensionDisposer;
  };
  readonly hooks: {
    register(
      name: string,
      callback: PublicHookHandler,
      schema: PublicHookPayloadSchema,
      priority?: number,
    ): ExtensionDisposer;
    invoke(
      name: string,
      payload: unknown,
      options?: PublicHookInvokeOptions,
    ): Promise<PublicHookInvocationResult>;
  };
  readonly services: {
    provide(definition: ExtensionServiceDefinition): ExtensionDisposer;
    resolve(id: string, version?: string): ExtensionServiceInfo | null;
    call(id: string, method: string, args?: readonly unknown[]): Promise<unknown>;
    onChange(id: string, listener: (info: ExtensionServiceInfo | null) => void): ExtensionDisposer;
    provideData<T>(definition: ExtensionDataProviderDefinition<T>): ExtensionDisposer;
    readData<T = unknown>(id: string, version?: string): ExtensionDataInfo<T> | null;
    updateData(id: string, value: unknown): void;
    onDataChange<T = unknown>(
      id: string,
      listener: (info: ExtensionDataInfo<T> | null) => void,
    ): ExtensionDisposer;
  };
  readonly scripts: {
    register(definition: ExtensionScriptDefinition): ExtensionDisposer;
  };
  readonly settings: ExtensionKeyValueStore;
  readonly storage: ExtensionJsonStore;
  readonly timers: {
    setTimeout(callback: () => void, delay: number): ReturnType<typeof globalThis.setTimeout>;
    setInterval(callback: () => void, delay: number): ReturnType<typeof globalThis.setInterval>;
    requestAnimationFrame(callback: FrameRequestCallback): number;
    clearTimeout?(handle: ReturnType<typeof globalThis.setTimeout>): void;
    clearInterval?(handle: ReturnType<typeof globalThis.setInterval>): void;
    cancelAnimationFrame(handle: number): void;
  };
  readonly styles: {
    add(cssText: string): ExtensionDisposer;
  };
  addCleanup(cleanup: ExtensionDisposer): ExtensionDisposer;
}

/** A host-resident package definition with an optional synchronous activator. */
export interface TrustedExtensionDefinition {
  manifest: TrustedExtensionManifest;
  translations?: ExtensionTranslations;
  activate?(context: ExtensionHostContext): void;
}

/** Code bytes for a sandboxed entry; the host never imports them in its realm. */
export interface SandboxedExtensionSource {
  readonly source: string;
  readonly translations?: ExtensionTranslations;
}

/** Resolves sandboxed entry source only after the host has accepted its risk. */
export type SandboxedExtensionLoader = () =>
  SandboxedExtensionSource | Promise<SandboxedExtensionSource>;

/** Lifecycle state of one loaded package. */
export type ExtensionStatus = "loaded" | "enabled" | "disabled" | "failed";

/** Stable codes callers can branch on when an operation fails. */
export type ExtensionOperationErrorCode =
  | "entryActivateRequired"
  | "manifestRequired"
  | "invalidId"
  | "nameVersionRequired"
  | "incompatibleHostVersion"
  | "invalidHostVersionRange"
  | "dependencyArrays"
  | "selfDependency"
  | "selfConflict"
  | "alreadyLoaded"
  | "manifestMismatch"
  | "entryLoadRequired"
  | "invalidTranslations"
  | "dataOnlyCapabilities"
  | "invalidKind"
  | "kindMismatch"
  | "invalidCollaboration"
  | "notLoaded"
  | "dependencyMissing"
  | "dependencyDisabled"
  | "dependencyCycle"
  | "riskNotAcknowledged"
  | "consentStale"
  | "invalidProvenance"
  | "invalidCapabilities"
  | "capabilityDenied"
  | "conflictEnabled"
  | "dependentEnabled";

/** Read-only status of one loaded package for the manager and public facade. */
export interface ExtensionStatusSnapshot {
  manifest: MaterializedExtensionManifest;
  status: ExtensionStatus;
  error: string | null;
  fingerprint: string | null;
  riskNotice: string;
  riskAcknowledged: boolean;
  /** Callback failures inside the current rolling window, for the manager. */
  failureCount: number;
  /** Most recent failure messages, newest last; bounded by the runtime. */
  recentErrors: readonly string[];
  /** Host-recorded origin of the package. */
  source: ExtensionSource;
  /** Host-provided label for that origin, e.g. an imported file name. */
  sourceLabel: string | null;
  /** Derived from the manifest shape, not from a declared field. */
  content: ExtensionContent;
  /** Computed by the host from the source and the fingerprint-bound consent. */
  trustState: ExtensionTrustState;
  consent: ExtensionConsent;
  provenance: ExtensionProvenance;
}

/** The outcome of a lifecycle operation; failures carry a stable code when known. */
export type ExtensionOperationResult =
  | { ok: true; status: ExtensionStatus; message?: string }
  | {
      ok: false;
      reason: string;
      code?: ExtensionOperationErrorCode;
      value?: string;
      extensionId?: string;
      dependencyId?: string;
    };

/** Host-supplied facts about where a definition came from. */
export interface ExtensionLoadOptions {
  fingerprint?: string;
  source?: ExtensionSource;
  sourceLabel?: string;
  /**
   * The host matched this package against the shipped built-in allowlist.
   * Only the loader may set this; package metadata cannot declare it.
   */
  verifiedBuiltin?: boolean;
}
