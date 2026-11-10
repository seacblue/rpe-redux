/* eslint-disable max-lines -- lifecycle, capability context, failure budget, and recovery share one state machine. */
/**
 * Loads, orders and unloads sandboxed extensions, owning every host resource they register.
 *
 * `ExtensionRuntime` validates manifests and consent, installs toolbar/sidebar UI and
 * persistence, and keeps status snapshots for the extensions surface.
 */
import { PREFERENCE_SECTIONS, preferences, type PreferenceStore } from "../state/preferences.ts";
import { BUILD_APP_VERSION } from "../platform/buildInfo.ts";
import { getLanguage, onLanguageChange, t } from "../../i18n/index.ts";
import { extensionRegistry } from "./runtime.ts";
import { ExtensionEventNameError, isExtensionEventName } from "./contract.ts";
import { settingsRegistry } from "../settings/settings.ts";
import { values as valueRegistry } from "../state/values.ts";
import type { ExtensionCallback, ExtensionDisposer } from "./registry.ts";
import { createExtensionUiContext, scriptRegistry } from "./scripts.ts";
import { requireExtensionApi } from "./extensionApi.ts";
import type { ReduxApi } from "../api/index.ts";
import {
  createExtensionI18n,
  registerExtensionTranslations,
  type ExtensionTranslations,
} from "./i18n.ts";
import {
  contentOf,
  consentOf,
  provenanceOf,
  resolveConsent,
  trustStateOf,
} from "./extensionTrust.ts";
import {
  normalizeCapabilities,
  requireExtensionCapability,
  type ExtensionCapability,
} from "./capabilities.ts";
import { gateExtensionApi } from "./capabilityGate.ts";
import { publicHookRegistry } from "./publicHooks.ts";
import type {
  PublicHookHandler,
  PublicHookInvokeOptions,
  PublicHookPayloadSchema,
} from "./publicHooks.ts";
import {
  callExtensionService,
  provideExtensionData,
  provideExtensionService,
  readExtensionData,
  removeExtensionServices,
  resolveExtensionService,
  subscribeExtensionData,
  subscribeExtensionService,
  updateExtensionData,
  type ExtensionDataInfo,
} from "./serviceRegistry.ts";
import type { SandboxExtensionContext } from "./sandbox.ts";
import {
  decodeExtensionStorageJson,
  encodeExtensionStorageJson,
  MAX_EXTENSION_STORE_VALUE_BYTES,
} from "./extensionStorageJson.ts";
import type {
  ExtensionLoadOptions,
  ExtensionSource,
  MaterializedExtensionManifest,
  ExtensionJsonStore,
  ExtensionKeyValueStore,
  ExtensionStatus,
  ExtensionStatusSnapshot,
  ExtensionOperationErrorCode,
  ExtensionOperationResult,
  ExtensionStyleHost,
  ExtensionTimerHost,
  ExtensionHostContext,
  SandboxedExtensionLoader,
  SandboxedExtensionSource,
  TrustedExtensionDefinition,
  TrustedExtensionManifest,
} from "./extensionContract.ts";
import type { ExtensionSandboxFactory, ExtensionSandboxHost } from "./sandbox.ts";
import {
  clearPersistedExtensionState,
  errorMessage,
  ExtensionScope,
  dataOnlyDefinition,
  freezeManifest,
  isDataOnlyManifest,
  materializeManifest,
  extensionPreferenceStore,
  registrationName,
  readExtensionOrder,
  readPersistedExtensionState,
  removeExtensionOrder,
  validateDataOnlyManifest,
  validateManifest,
  writeExtensionOrder,
  writePersistedExtensionState,
} from "./extensionRuntimeSupport.ts";

export type {
  ExtensionConsent,
  ExtensionCollaborationMode,
  ExtensionContent,
  ExtensionLoadOptions,
  ExtensionProvenance,
  ExtensionSource,
  ExtensionTrustState,
  ExtensionJsonStore,
  ExtensionKeyValueStore,
  ExtensionOperationErrorCode,
  ExtensionOperationResult,
  ExtensionStatus,
  ExtensionStatusSnapshot,
  ExtensionStyleHost,
  ExtensionTimerHost,
  ExtensionHostContext,
  SandboxedExtensionLoader,
  SandboxedExtensionSource,
  TrustedExtensionDefinition,
  TrustedExtensionManifest,
} from "./extensionContract.ts";

/** Risk notice shown before a package's first activation. */
export const TRUSTED_EXTENSION_RISK_NOTICE =
  "Extensions run in an isolated iframe and can only reach the capability-gated bridge exposed to them.";

const FAILURE_WINDOW_MS = 30_000;
const FAILURE_LIMIT = 5;
const FAILURE_LOG_LIMIT = 12;
const MAX_TIMER_HANDLES = 64;
const MIN_INTERVAL_MS = 16;
const MAX_EVENT_SUBSCRIPTIONS = 128;
/**
 * Timer limits shared with the sandbox bridge.
 *
 * The iframe mirrors the live-handle budget for a synchronous error and clamps
 * intervals before sending them; the host timer wrapper remains authoritative.
 */
export const EXTENSION_TIMER_LIMITS = Object.freeze({
  maxTimers: MAX_TIMER_HANDLES,
  minIntervalMs: MIN_INTERVAL_MS,
});
const MAX_EXTENSION_SCRIPTS = 64;
const MAX_EXTENSION_STYLES = 32;
const MAX_STYLE_BYTES = 100_000;
const MAX_STORE_KEY_LENGTH = 128;
const MAX_STORE_VALUE_BYTES = MAX_EXTENSION_STORE_VALUE_BYTES;
const MAX_ENTRY_SOURCE_BYTES = 2_000_000;
/**
 * Stable code for a dependency cycle. The shared result union exposes the same
 * string; the runtime keeps the local alias because the contract module owns
 * the public error vocabulary.
 */
const DEPENDENCY_CYCLE_CODE = "dependencyCycle" as ExtensionOperationErrorCode;

interface ExtensionFailureLog {
  windowStart: number;
  count: number;
  recent: string[];
}

/** One in-flight asynchronous activation and everything it has created so far. */
interface ExtensionActivation {
  readonly epoch: number;
  readonly controller: AbortController;
  promise: Promise<ExtensionOperationResult> | null;
  sandbox: ExtensionSandboxHost | null;
  scope: ExtensionScope | null;
}

/** Create an empty failure window for one record. */
function newFailureLog(): ExtensionFailureLog {
  return { windowStart: 0, count: 0, recent: [] };
}

interface ExtensionRecord {
  manifest: MaterializedExtensionManifest;
  capabilities: readonly ExtensionCapability[];
  failures: ExtensionFailureLog;
  fingerprint: string | null;
  source: ExtensionSource;
  sourceLabel: string | null;
  /** Host-verified against the shipped built-in manifest allowlist. */
  verifiedBuiltin: boolean;
  definition: TrustedExtensionDefinition | null;
  loader: SandboxedExtensionLoader | null;
  sandboxSource: SandboxedExtensionSource | null;
  sandbox: ExtensionSandboxHost | null;
  translations: ExtensionTranslations | undefined;
  translationDispose: ExtensionDisposer;
  status: ExtensionStatus;
  error: string | null;
  scope: ExtensionScope | null;
  /** Monotonic activation generation; a cancellation advances it. */
  activationEpoch: number;
  /** Set only while an asynchronous activation is in flight. */
  activation: ExtensionActivation | null;
  riskAcknowledged: boolean;
  /** The fingerprint the user confirmed, or null when consent is not bound. */
  acknowledgedFingerprint: string | null;
  /** Persisted consent exists for a different fingerprint. */
  consentStale: boolean;
}

/** Timer implementation backed by the global functions. */
const defaultTimers: ExtensionTimerHost = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
  requestAnimationFrame: (callback) => globalThis.requestAnimationFrame(callback),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  clearInterval: (handle) => globalThis.clearInterval(handle),
  cancelAnimationFrame: (handle) => globalThis.cancelAnimationFrame(handle),
};

/** Host seams the runtime accepts; each defaults to the application service. */
export interface ExtensionRuntimeOptions {
  /** Persistence for consent, order, and package stores. */
  preferenceStore?: PreferenceStore;
  /** Sink for package stylesheets; absent styles are dropped. */
  styleHost?: ExtensionStyleHost | null;
  /** Timer implementation; defaults to the global functions. */
  timers?: ExtensionTimerHost;
  /**
   * The host application version used for manifest `engines` checks. Defaults to
   * the version baked into the bundle; Node smokes pass it explicitly because
   * `__REDUX_VERSION__` does not exist outside Vite.
   */
  hostVersion?: string;
  /** Frontend-owned iframe bridge; code packages cannot run without it. */
  sandboxFactory?: ExtensionSandboxFactory | null;
}

/** Manages sandboxed Extensions and owns every host resource they register. */
export class ExtensionRuntime {
  private readonly records = new Map<string, ExtensionRecord>();
  private readonly listeners = new Set<() => void>();
  private readonly preferenceStore: PreferenceStore;
  private styleHost: ExtensionStyleHost | null;
  private readonly timers: ExtensionTimerHost;
  private readonly hostVersion: string;
  private sandboxFactory: ExtensionSandboxFactory | null;
  private snapshot: readonly ExtensionStatusSnapshot[] = Object.freeze([]);
  private reloadChain: Promise<void> = Promise.resolve();

  /** Create a runtime with optional host seams; defaults bind application services. */
  constructor(options: ExtensionRuntimeOptions = {}) {
    this.preferenceStore = options.preferenceStore ?? preferences;
    this.styleHost = options.styleHost ?? null;
    this.timers = options.timers ?? defaultTimers;
    this.hostVersion = options.hostVersion ?? BUILD_APP_VERSION;
    this.sandboxFactory = options.sandboxFactory ?? null;
  }

  /** Attach the host-owned style sink without exposing DOM objects to a package. */
  setStyleHost(styleHost: ExtensionStyleHost | null): void {
    this.styleHost = styleHost;
  }

  /** Attach the frontend iframe bridge before packaged Extensions load. */
  setSandboxFactory(factory: ExtensionSandboxFactory | null): void {
    this.sandboxFactory = factory;
  }

  /** Observe status-snapshot changes. */
  subscribe(listener: () => void): ExtensionDisposer {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Rebuild the ordered snapshot and notify subscribers. */
  private publish(): void {
    this.snapshot = Object.freeze(
      this.orderedRecords().map((record) => ({
        manifest: Object.freeze({
          ...record.manifest,
          ...(record.manifest.dependencies
            ? { dependencies: Object.freeze([...record.manifest.dependencies]) }
            : {}),
          ...(record.manifest.conflicts
            ? { conflicts: Object.freeze([...record.manifest.conflicts]) }
            : {}),
        }),
        status: record.status,
        error: record.error,
        fingerprint: record.fingerprint,
        riskNotice: TRUSTED_EXTENSION_RISK_NOTICE,
        riskAcknowledged: record.riskAcknowledged,
        failureCount: record.failures.count,
        recentErrors: Object.freeze([...record.failures.recent]),
        source: record.source,
        sourceLabel: record.sourceLabel,
        content: contentOf(record.manifest),
        trustState: trustStateOf(record),
        consent: consentOf(record),
        provenance: Object.freeze(provenanceOf(record.manifest)),
      })),
    );
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
  /** Register metadata without evaluating the entry module. */
  loadManifest(
    manifest: TrustedExtensionManifest,
    loader?: SandboxedExtensionLoader,
    options: ExtensionLoadOptions = {},
  ): ExtensionOperationResult {
    const normalizedManifest = freezeManifest(materializeManifest(manifest, manifest.translations));
    const manifestError =
      validateManifest(normalizedManifest, this.hostVersion) ??
      (loader === undefined ? validateDataOnlyManifest(normalizedManifest) : null);
    if (manifestError) {
      return {
        ok: false,
        reason: manifestError.reason,
        code: manifestError.code,
        value: manifestError.value,
        extensionId: typeof normalizedManifest?.id === "string" ? normalizedManifest.id : undefined,
      };
    }
    if (this.records.has(normalizedManifest.id)) {
      return {
        ok: false,
        reason: "Extension id is already loaded",
        code: "alreadyLoaded",
        extensionId: normalizedManifest.id,
      };
    }
    const cycle = this.dependencyCycle(normalizedManifest.id, normalizedManifest);
    if (cycle) {
      return {
        ok: false,
        reason: `Extension dependency cycle: ${cycle.join(" -> ")}`,
        code: DEPENDENCY_CYCLE_CODE,
        extensionId: normalizedManifest.id,
        dependencyId: cycle[1],
        value: cycle.join(" -> "),
      };
    }
    const resolvedManifest = normalizedManifest as MaterializedExtensionManifest;
    const persisted = readPersistedExtensionState(resolvedManifest, this.preferenceStore);
    const fingerprint = options.fingerprint ?? null;
    const source = options.source ?? "source";
    this.records.set(resolvedManifest.id, {
      manifest: resolvedManifest,
      capabilities: normalizeCapabilities(resolvedManifest.capabilities),
      failures: newFailureLog(),
      fingerprint,
      source,
      sourceLabel: options.sourceLabel ?? null,
      verifiedBuiltin: options.verifiedBuiltin === true,
      ...resolveConsent(fingerprint, persisted, options.verifiedBuiltin === true),
      definition: null,
      loader: loader ?? null,
      sandboxSource: null,
      sandbox: null,
      translations: resolvedManifest.translations,
      translationDispose: registerExtensionTranslations(
        resolvedManifest.id,
        resolvedManifest.translations,
        registrationName(resolvedManifest, resolvedManifest.translations),
      ),
      status: "loaded",
      error: null,
      scope: null,
      activationEpoch: 0,
      activation: null,
    });
    this.ensureOrderEntry(resolvedManifest.id);
    this.publish();
    return { ok: true, status: "loaded" };
  }

  /**
   * Enable a record whose definition is already resident.
   *
   * A loader-backed package returns `entryLoadRequired`; use `enableAsync`.
   */
  enable(extensionId: string, acknowledgeRisk = false): ExtensionOperationResult {
    const record = this.records.get(extensionId);
    if (!record) {
      return { ok: false, reason: "Extension is not loaded", code: "notLoaded", extensionId };
    }
    if (record.status === "enabled") {
      return { ok: true, status: "enabled", message: "Extension is already enabled" };
    }
    const preparation = this.prepareEnable(record, acknowledgeRisk);
    if (preparation) {
      return preparation;
    }
    if (!record.definition && isDataOnlyManifest(record.manifest)) {
      return this.activateDefinition(record, dataOnlyDefinition(record.manifest));
    }
    if (!record.definition) {
      return {
        ok: false,
        reason: "This Extension entry must be resolved asynchronously after consent",
        code: "entryLoadRequired",
        extensionId,
      };
    }
    return this.activateDefinition(record, record.definition);
  }

  /** Enable a metadata-only record, resolving its entry after the risk gate. */
  async enableAsync(
    extensionId: string,
    acknowledgeRisk = false,
  ): Promise<ExtensionOperationResult> {
    const record = this.records.get(extensionId);
    if (!record) {
      return { ok: false, reason: "Extension is not loaded", code: "notLoaded", extensionId };
    }
    if (record.status === "enabled") {
      return { ok: true, status: "enabled", message: "Extension is already enabled" };
    }
    // A second enable while the first is still loading shares that activation;
    // it must not create a second sandbox or a second scope.
    if (record.activation?.promise) {
      return record.activation.promise;
    }
    const preparation = this.prepareEnable(record, acknowledgeRisk);
    if (preparation) {
      return preparation;
    }
    if (record.definition) {
      return this.activateDefinition(record, record.definition);
    }
    if (isDataOnlyManifest(record.manifest)) {
      return this.activateDefinition(record, dataOnlyDefinition(record.manifest));
    }
    if (!record.sandboxSource && !record.loader) {
      return {
        ok: false,
        reason: "This Extension has no entry loader",
        code: "entryLoadRequired",
        extensionId,
      };
    }
    const activation = this.beginActivation(record);
    const promise = this.runAsyncActivation(record, activation);
    activation.promise = promise;
    try {
      return await promise;
    } finally {
      if (record.activation === activation) {
        record.activation = null;
      }
    }
  }

  /** Start one activation generation and return its cancellation state. */
  private beginActivation(record: ExtensionRecord): ExtensionActivation {
    const activation: ExtensionActivation = {
      epoch: ++record.activationEpoch,
      controller: new AbortController(),
      promise: null,
      sandbox: null,
      scope: null,
    };
    record.activation = activation;
    return activation;
  }

  /** Whether this activation is still the record's current generation. */
  private isActivationCurrent(record: ExtensionRecord, activation: ExtensionActivation): boolean {
    return (
      record.activation === activation &&
      activation.epoch === record.activationEpoch &&
      !activation.controller.signal.aborted
    );
  }

  /** The result a cancelled activation resolves with; it never changes status. */
  private cancelledActivation(record: ExtensionRecord): ExtensionOperationResult {
    return {
      ok: false,
      reason: "Extension activation was cancelled",
      extensionId: record.manifest.id,
    };
  }

  /** Dispose everything an in-flight activation has created, in reverse order. */
  private disposeActivation(
    record: ExtensionRecord,
    activation: ExtensionActivation,
    purge = false,
  ): void {
    const sandbox = activation.sandbox;
    const scope = activation.scope;
    activation.sandbox = null;
    activation.scope = null;
    try {
      sandbox?.dispose();
    } finally {
      // Values forget their owner when the scope cleanup runs, so purge after the
      // sandbox can no longer write, while the definitions are still registered.
      if (purge) {
        valueRegistry.purgeOwner(record.manifest.id);
      }
      try {
        scope?.dispose();
      } finally {
        extensionRegistry.removeOwner(record.manifest.id);
        if (purge) {
          settingsRegistry.purgeOwner(record.manifest.id);
        } else {
          settingsRegistry.unregisterOwner(record.manifest.id);
          valueRegistry.removeOwner(record.manifest.id);
        }
      }
    }
  }

  /**
   * Invalidate one in-flight activation and release what it already created.
   *
   * The activation's late resolution sees a stale generation and resolves as
   * cancelled instead of publishing a sandbox or changing the record status.
   */
  private cancelActivation(record: ExtensionRecord, purge = false): void {
    const activation = record.activation;
    if (!activation) {
      return;
    }
    record.activation = null;
    record.activationEpoch += 1;
    activation.controller.abort();
    try {
      this.disposeActivation(record, activation, purge);
    } catch (error) {
      console.error("[redux.extensions] activation cancellation cleanup failed", {
        id: record.manifest.id,
        error,
      });
    }
  }

  /** Resolve the entry, then activate it unless the generation was cancelled. */
  private async runAsyncActivation(
    record: ExtensionRecord,
    activation: ExtensionActivation,
  ): Promise<ExtensionOperationResult> {
    try {
      let source = record.sandboxSource;
      if (!source) {
        const loader = record.loader;
        if (!loader) {
          return {
            ok: false,
            reason: "This Extension has no entry loader",
            code: "entryLoadRequired",
            extensionId: record.manifest.id,
          };
        }
        source = await loader();
        if (!this.isActivationCurrent(record, activation)) {
          return this.cancelledActivation(record);
        }
        if (!source || typeof source.source !== "string" || !source.source.trim()) {
          throw new Error("Extension entry source is empty");
        }
        if (new TextEncoder().encode(source.source).byteLength > MAX_ENTRY_SOURCE_BYTES) {
          throw new Error(`Extension entry source exceeds ${MAX_ENTRY_SOURCE_BYTES} bytes`);
        }
        record.sandboxSource = source;
        if (source.translations) {
          record.translations = source.translations;
        }
      }
      if (!this.isActivationCurrent(record, activation)) {
        return this.cancelledActivation(record);
      }
      return await this.activateSandbox(record, source, activation);
    } catch (error) {
      if (!this.isActivationCurrent(record, activation)) {
        return this.cancelledActivation(record);
      }
      record.status = "failed";
      record.error = errorMessage(error);
      this.persistState(record, false);
      this.publish();
      console.error("[redux.extensions] entry evaluation failed", {
        id: record.manifest.id,
        version: record.manifest.version,
        error,
      });
      return { ok: false, reason: record.error, extensionId: record.manifest.id };
    }
  }

  /** Disable one package; refused while an enabled package depends on it. */
  disable(extensionId: string): ExtensionOperationResult {
    const record = this.records.get(extensionId);
    if (!record) {
      return { ok: false, reason: "Extension is not loaded", code: "notLoaded", extensionId };
    }
    if (record.activation) {
      this.cancelActivation(record);
      record.scope = null;
      record.status = "disabled";
      record.error = null;
      this.persistState(record, false);
      this.publish();
      return { ok: true, status: "disabled", message: "Extension activation cancelled" };
    }
    if (record.status !== "enabled") {
      return { ok: true, status: record.status, message: "Extension is not enabled" };
    }
    const dependent = this.enabledDependentOf(extensionId);
    if (dependent) {
      return {
        ok: false,
        reason: `Enabled Extension depends on this Extension: ${dependent.manifest.id}`,
        code: "dependentEnabled",
        extensionId,
        dependencyId: extensionId,
        value: dependent.manifest.id,
      };
    }
    try {
      if (record.scope) {
        this.disposeRecord(record, record.scope);
      }
      record.scope = null;
      record.status = "disabled";
      record.error = null;
      this.persistState(record, false);
      this.publish();
      return { ok: true, status: "disabled" };
    } catch (error) {
      record.scope = null;
      record.status = "failed";
      record.error = errorMessage(error);
      this.persistState(record, false);
      this.publish();
      console.error("[redux.extensions] disable cleanup failed", {
        id: record.manifest.id,
        version: record.manifest.version,
        error,
      });
      return { ok: false, reason: record.error, extensionId };
    }
  }

  /**
   * Stop enabled packages that depend on `extensionId` so it can be reloaded.
   *
   * A suspended record keeps its persisted enabled flag and gains a visible
   * error; the next `restorePersisted()` pass brings it back once the dependency
   * is enabled again. This is the minimal dependency-change notification the
   * loader uses before replacing a package's bytes.
   */
  suspendDependents(
    extensionId: string,
    reason = `Dependency ${extensionId} changed`,
  ): readonly string[] {
    const suspended: string[] = [];
    for (const record of this.teardownOrder(this.dependentsOf(extensionId))) {
      if (record.status !== "enabled" && !record.activation) {
        continue;
      }
      if (record.activation) {
        this.cancelActivation(record);
        record.scope = null;
      } else {
        try {
          if (record.scope) {
            this.disposeRecord(record, record.scope);
          }
        } catch (error) {
          console.error("[redux.extensions] dependent cleanup failed", {
            id: record.manifest.id,
            dependency: extensionId,
            error,
          });
        }
        record.scope = null;
      }
      record.status = "disabled";
      record.error = reason;
      suspended.push(record.manifest.id);
    }
    if (suspended.length) {
      this.publish();
    }
    return Object.freeze(suspended);
  }

  /**
   * Force every loaded package off, visiting dependents before dependencies.
   *
   * Used by the recovery path so a broken package can be stopped even when its
   * dependency graph is inconsistent. A cycle falls back to the recorded order.
   */
  disableAll(): readonly ExtensionOperationResult[] {
    const results: ExtensionOperationResult[] = [];
    for (const record of this.teardownOrder([...this.records.values()])) {
      if (record.activation) {
        this.cancelActivation(record);
        record.scope = null;
        record.status = "disabled";
        record.error = null;
        this.persistState(record, false);
        results.push({ ok: true, status: "disabled", message: "Extension activation cancelled" });
        continue;
      }
      if (record.status !== "enabled") {
        continue;
      }
      try {
        if (record.scope) {
          this.disposeRecord(record, record.scope);
        }
        record.scope = null;
        record.status = "disabled";
        record.error = null;
        this.persistState(record, false);
        results.push({ ok: true, status: "disabled" });
      } catch (error) {
        record.scope = null;
        record.status = "failed";
        record.error = errorMessage(error);
        this.persistState(record, false);
        results.push({ ok: false, reason: record.error, extensionId: record.manifest.id });
      }
    }
    this.publish();
    return Object.freeze(results);
  }

  /** Count one callback failure and stop a package that keeps failing. */
  private recordFailure(id: string, error: unknown, action: string): void {
    const record = this.records.get(id);
    if (!record) {
      return;
    }
    const now = Date.now();
    if (!record.failures.windowStart || now - record.failures.windowStart > FAILURE_WINDOW_MS) {
      record.failures.windowStart = now;
      record.failures.count = 0;
    }
    record.failures.count += 1;
    record.failures.recent.push(`${action}: ${errorMessage(error)}`);
    if (record.failures.recent.length > FAILURE_LOG_LIMIT) {
      record.failures.recent.splice(0, record.failures.recent.length - FAILURE_LOG_LIMIT);
    }
    if (record.failures.count >= FAILURE_LIMIT && record.status === "enabled") {
      record.error = `Extension failure budget exceeded: ${action}`;
      this.persistState(record, false);
      queueMicrotask(() => {
        if (this.records.get(id) === record && record.status === "enabled") {
          this.forceDisable(record, record.error ?? "Extension failure budget exceeded");
        }
      });
    }
    this.publish();
  }

  /**
   * Count a callback failure only while the activation that produced it is
   * current. A sandbox from an older generation may still deliver a late error
   * after a disable or a new enable; that error is logged but does not consume
   * the new activation's failure budget.
   */
  private reportActivationFailure(
    record: ExtensionRecord,
    generation: number,
    error: unknown,
    action: string,
  ): void {
    const activation = record.activation;
    const current =
      record.activationEpoch === generation &&
      (activation?.epoch === generation || (activation === null && record.status === "enabled"));
    if (!current) {
      console.warn("[redux.extensions] ignored a stale sandbox failure", {
        id: record.manifest.id,
        generation,
        action,
        error: errorMessage(error),
      });
      return;
    }
    this.recordFailure(record.manifest.id, error, action);
  }

  /** Stop a failing record, its dependents, and persist the failure reason. */
  private forceDisable(record: ExtensionRecord, reason: string): void {
    const dependents = this.teardownOrder(this.dependentsOf(record.manifest.id));
    try {
      if (record.scope) {
        this.disposeRecord(record, record.scope);
      }
    } catch (error) {
      reason = `${reason}; cleanup failed: ${errorMessage(error)}`;
    }
    record.scope = null;
    record.status = "failed";
    record.error = reason;
    this.persistState(record, false);
    for (const dependent of dependents) {
      if (dependent.status !== "enabled") {
        continue;
      }
      let dependentReason = `Dependency ${record.manifest.id} was stopped: ${reason}`;
      try {
        if (dependent.scope) {
          this.disposeRecord(dependent, dependent.scope);
        }
      } catch (error) {
        dependentReason = `${dependentReason}; cleanup failed: ${errorMessage(error)}`;
      }
      dependent.scope = null;
      dependent.status = "failed";
      dependent.error = dependentReason;
      this.persistState(dependent, false);
      console.error("[redux.extensions] dependency stopped an enabled Extension", {
        id: dependent.manifest.id,
        dependency: record.manifest.id,
      });
    }
    this.publish();
  }

  /**
   * Remove a loaded package from the runtime while keeping user state.
   *
   * Consent, enablement, order, settings, and values survive so re-registering
   * the same bytes restores the previous state. Explicit removal uses
   * `uninstall`; only that path clears persisted state.
   */
  unload(extensionId: string, options: { purge?: boolean } = {}): ExtensionOperationResult {
    const record = this.records.get(extensionId);
    if (!record) {
      return { ok: false, reason: "Extension is not loaded", code: "notLoaded", extensionId };
    }
    const dependent = this.enabledDependentOf(extensionId);
    if (dependent) {
      return {
        ok: false,
        reason: `Enabled Extension depends on this Extension: ${dependent.manifest.id}`,
        code: "dependentEnabled",
        extensionId,
        dependencyId: extensionId,
        value: dependent.manifest.id,
      };
    }
    if (record.activation) {
      this.cancelActivation(record, options.purge === true);
      record.scope = null;
    } else if (record.scope) {
      try {
        this.disposeRecord(record, record.scope, options.purge === true);
      } catch (error) {
        record.scope = null;
        record.status = "failed";
        record.error = errorMessage(error);
        this.publish();
        return { ok: false, reason: record.error, extensionId };
      }
      record.scope = null;
    }
    this.records.delete(extensionId);
    record.sandboxSource = null;
    record.loader = null;
    record.translationDispose();
    this.publish();
    return { ok: true, status: "disabled", message: "Extension unloaded" };
  }

  /**
   * Remove a package and purge its storage, settings, values, consent, and order.
   *
   * Runtime-only unload keeps user data for a later reinstall; this explicit
   * removal is the only path that deletes the owner's stored answers.
   */
  uninstall(extensionId: string): ExtensionOperationResult {
    const record = this.records.get(extensionId);
    if (!record) {
      return { ok: false, reason: "Extension is not loaded", code: "notLoaded", extensionId };
    }
    const manifest = record.manifest;
    const result = this.unload(extensionId, { purge: true });
    if (!result.ok) {
      return result;
    }
    clearPersistedExtensionState(manifest, this.preferenceStore);
    extensionPreferenceStore(PREFERENCE_SECTIONS.values, extensionId, this.preferenceStore).clear();
    removeExtensionOrder(extensionId, this.preferenceStore);
    settingsRegistry.purgeOwner(extensionId);
    valueRegistry.purgeOwner(extensionId);
    return { ok: true, status: "disabled", message: "Extension uninstalled" };
  }

  /** The current ordered status snapshots. */
  list(): readonly ExtensionStatusSnapshot[] {
    return this.snapshot;
  }

  /**
   * Persist a new extension load order. The order is used immediately by
   * `list()` and by the next `restorePersisted()` activation pass.
   */
  setOrder(ids: readonly string[]): void {
    const known = new Set(this.records.keys());
    const next = ids.filter(
      (id, index): id is string => known.has(id) && ids.indexOf(id) === index,
    );
    for (const id of known) {
      if (!next.includes(id)) {
        next.push(id);
      }
    }
    writeExtensionOrder(next, this.preferenceStore);
    this.publish();
  }

  /** Records in persisted order; unranked records follow ranked ones. */
  private orderedRecords(): ExtensionRecord[] {
    const order = readExtensionOrder(this.preferenceStore);
    const index = new Map(order.map((id, position) => [id, position]));
    return [...this.records.values()].sort((left, right) => {
      const leftIndex = index.get(left.manifest.id);
      const rightIndex = index.get(right.manifest.id);
      if (leftIndex === undefined && rightIndex === undefined) {
        return 0;
      }
      if (leftIndex === undefined) {
        return 1;
      }
      if (rightIndex === undefined) {
        return -1;
      }
      return leftIndex - rightIndex;
    });
  }

  /** Append a newly loaded id to the persisted order when it is missing. */
  private ensureOrderEntry(id: string): void {
    const order = readExtensionOrder(this.preferenceStore);
    if (order.includes(id)) {
      return;
    }
    writeExtensionOrder([...order, id], this.preferenceStore);
  }

  /** The first enabled record that directly depends on `extensionId`. */
  private enabledDependentOf(extensionId: string): ExtensionRecord | undefined {
    return [...this.records.values()].find(
      (candidate) =>
        candidate.status === "enabled" &&
        (candidate.manifest.dependencies ?? []).includes(extensionId),
    );
  }

  /** Every loaded record that transitively depends on `extensionId`. */
  private dependentsOf(extensionId: string): ExtensionRecord[] {
    const matched = new Set([extensionId]);
    const dependents: ExtensionRecord[] = [];
    let added = true;
    while (added) {
      added = false;
      for (const record of this.records.values()) {
        if (matched.has(record.manifest.id)) {
          continue;
        }
        if ((record.manifest.dependencies ?? []).some((dependency) => matched.has(dependency))) {
          matched.add(record.manifest.id);
          dependents.push(record);
          added = true;
        }
      }
    }
    return dependents;
  }

  /**
   * Order records so dependents come before their dependencies.
   *
   * A graph with a cycle cannot be fully ordered; the remaining records keep
   * their recorded reverse order and the fallback is reported.
   */
  private teardownOrder(records: readonly ExtensionRecord[]): ExtensionRecord[] {
    const remaining = [...records];
    const ordered: ExtensionRecord[] = [];
    while (remaining.length) {
      let index = -1;
      for (let cursor = remaining.length - 1; cursor >= 0; cursor -= 1) {
        const candidate = remaining[cursor];
        const hasDependent = remaining.some(
          (other) =>
            other !== candidate &&
            (other.manifest.dependencies ?? []).includes(candidate.manifest.id),
        );
        if (!hasDependent) {
          index = cursor;
          break;
        }
      }
      if (index < 0) {
        console.warn("[redux.extensions] dependency cycle breaks teardown order", {
          ids: remaining.map((record) => record.manifest.id),
        });
        ordered.push(...remaining.splice(0).reverse());
        break;
      }
      ordered.push(remaining.splice(index, 1)[0]);
    }
    return ordered;
  }

  /**
   * Find a dependency cycle reachable from `startId`, including a candidate
   * manifest that is not loaded yet. Returns the cycle path with its start
   * repeated, or null when the reachable graph is acyclic.
   */
  private dependencyCycle(
    startId: string,
    candidate: TrustedExtensionManifest | null = null,
  ): string[] | null {
    const manifests = new Map<string, TrustedExtensionManifest>();
    for (const record of this.records.values()) {
      manifests.set(record.manifest.id, record.manifest);
    }
    if (candidate) {
      manifests.set(candidate.id, candidate);
    }
    const stack: string[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): string[] | null => {
      if (visiting.has(id)) {
        return [...stack.slice(stack.indexOf(id)), id];
      }
      if (visited.has(id) || !manifests.has(id)) {
        return null;
      }
      visiting.add(id);
      stack.push(id);
      for (const dependency of manifests.get(id)?.dependencies ?? []) {
        const cycle = visit(dependency);
        if (cycle) {
          return cycle;
        }
      }
      stack.pop();
      visiting.delete(id);
      visited.add(id);
      return null;
    };
    return visit(startId);
  }

  /** Restore previously acknowledged and enabled records after metadata discovery. */
  async restorePersisted(): Promise<readonly ExtensionOperationResult[]> {
    const pending = this.orderedRecords().filter((record) => {
      const state = readPersistedExtensionState(record.manifest, this.preferenceStore);
      // A record whose bytes no longer match stored consent stays off while
      // consent is stale.
      return state.enabled && consentOf(record) === "current";
    });
    const results: ExtensionOperationResult[] = [];
    while (pending.length) {
      let progressed = false;
      for (let index = 0; index < pending.length; index += 1) {
        const record = pending[index];
        if (
          (record.manifest.dependencies ?? []).some(
            (dependencyId) => this.records.get(dependencyId)?.status !== "enabled",
          )
        ) {
          continue;
        }
        pending.splice(index, 1);
        results.push(await this.enableAsync(record.manifest.id, true));
        progressed = true;
        break;
      }
      if (!progressed) {
        break;
      }
    }
    return Object.freeze(results);
  }

  /**
   * Re-activate every enabled package after a language switch.
   *
   * Panels, sidebar labels, and declarative trees are built from resolved text
   * at activation, so a reload makes them follow the new language.
   */
  reloadEnabled(): Promise<void> {
    // Language changes can arrive in quick succession; serialize reloads so a
    // package is never activated twice from overlapping passes.
    const next = this.reloadChain.then(
      () => this.performReload(),
      () => this.performReload(),
    );
    this.reloadChain = next.catch(() => undefined);
    return next;
  }

  /** Dispose and re-enable the captured set, dependencies first. */
  private async performReload(): Promise<void> {
    const enabled = this.orderedRecords().filter((record) => record.status === "enabled");
    if (!enabled.length) {
      return;
    }
    for (const record of this.teardownOrder(enabled)) {
      if (record.scope) {
        try {
          this.disposeRecord(record, record.scope);
        } catch (error) {
          console.error("[redux.extensions] language reload cleanup failed", {
            id: record.manifest.id,
            error,
          });
        }
      }
      record.scope = null;
      record.status = "disabled";
      record.error = null;
    }
    this.publish();
    // Re-enable dependencies before their dependents, matching restorePersisted.
    const pending = [...enabled];
    while (pending.length) {
      let progressed = false;
      for (let index = 0; index < pending.length; index += 1) {
        const record = pending[index];
        if (
          (record.manifest.dependencies ?? []).some(
            (dependencyId) => this.records.get(dependencyId)?.status !== "enabled",
          )
        ) {
          continue;
        }
        pending.splice(index, 1);
        await this.enableAsync(record.manifest.id, true);
        progressed = true;
        break;
      }
      if (!progressed) {
        break;
      }
    }
  }

  /** Check consent, dependencies, and conflicts before activation. */
  private prepareEnable(
    record: ExtensionRecord,
    acknowledgeRisk: boolean,
  ): Extract<ExtensionOperationResult, { ok: false }> | null {
    if (record.status === "enabled") {
      return null;
    }
    const consent = consentOf(record);
    if (consent === "stale" && !acknowledgeRisk) {
      return {
        ok: false,
        reason: t("settings.extensions.error.consentStale"),
        code: "consentStale",
        extensionId: record.manifest.id,
      };
    }
    if (acknowledgeRisk && consent !== "current") {
      record.riskAcknowledged = true;
      record.acknowledgedFingerprint = record.fingerprint;
      record.consentStale = false;
      this.persistState(record, false);
      this.publish();
    }
    if (!record.riskAcknowledged) {
      return {
        ok: false,
        reason: TRUSTED_EXTENSION_RISK_NOTICE,
        code: "riskNotAcknowledged",
        extensionId: record.manifest.id,
      };
    }
    const cycle = this.dependencyCycle(record.manifest.id);
    if (cycle) {
      return {
        ok: false,
        reason: `Extension dependency cycle: ${cycle.join(" -> ")}`,
        code: DEPENDENCY_CYCLE_CODE,
        extensionId: record.manifest.id,
        dependencyId: cycle[1],
        value: cycle.join(" -> "),
      };
    }
    for (const dependencyId of record.manifest.dependencies ?? []) {
      const dependency = this.records.get(dependencyId);
      if (!dependency) {
        return {
          ok: false,
          reason: "Required dependency is not loaded",
          code: "dependencyMissing",
          extensionId: record.manifest.id,
          dependencyId,
        };
      }
      if (dependency.status !== "enabled") {
        return {
          ok: false,
          reason: "Required dependency is not enabled",
          code: "dependencyDisabled",
          extensionId: record.manifest.id,
          dependencyId,
        };
      }
    }
    for (const conflictId of record.manifest.conflicts ?? []) {
      if (this.records.get(conflictId)?.status === "enabled") {
        return {
          ok: false,
          reason: `Extension conflicts with enabled Extension: ${conflictId}`,
          code: "conflictEnabled",
          extensionId: record.manifest.id,
          value: conflictId,
        };
      }
    }
    return null;
  }

  /** Persist the record's consent and enabled flag for its current version. */
  private persistState(record: ExtensionRecord, enabled: boolean): void {
    writePersistedExtensionState(
      record.manifest,
      {
        acknowledged: record.riskAcknowledged,
        enabled,
        fingerprint: record.acknowledgedFingerprint,
      },
      this.preferenceStore,
    );
  }

  /** Activate a host-resident definition in a fresh scope and persist success. */
  private activateDefinition(
    record: ExtensionRecord,
    definition: TrustedExtensionDefinition,
  ): ExtensionOperationResult {
    record.definition = definition;
    const scope = new ExtensionScope();
    try {
      definition.activate?.(this.createContext(record, scope, record.translations));
      record.scope = scope;
      record.status = "enabled";
      record.error = null;
      record.failures = newFailureLog();
      this.persistState(record, true);
      this.publish();
      return { ok: true, status: "enabled" };
    } catch (error) {
      let failure: unknown = error;
      try {
        this.disposeRecord(record, scope);
      } catch (cleanupError) {
        failure = new AggregateError(
          [error, cleanupError],
          "Extension activation and cleanup failed",
        );
      }
      record.status = "failed";
      record.error = errorMessage(failure);
      this.persistState(record, false);
      this.publish();
      console.error("[redux.extensions] activation failed", {
        id: record.manifest.id,
        version: record.manifest.version,
        error: failure,
      });
      return { ok: false, reason: record.error, extensionId: record.manifest.id };
    }
  }

  /** Start a package entry in the iframe sandbox and persist success. */
  private async activateSandbox(
    record: ExtensionRecord,
    source: SandboxedExtensionSource,
    activation: ExtensionActivation,
  ): Promise<ExtensionOperationResult> {
    const factory = this.sandboxFactory;
    if (!factory) {
      return {
        ok: false,
        reason: "Extension sandbox is unavailable",
        code: "entryLoadRequired",
        extensionId: record.manifest.id,
      };
    }
    const scope = new ExtensionScope();
    activation.scope = scope;
    let sandbox: ExtensionSandboxHost | null = null;
    const generation = activation.epoch;
    try {
      if (!this.isActivationCurrent(record, activation)) {
        return this.cancelledActivation(record);
      }
      const context = this.createContext(record, scope, record.translations, generation);
      sandbox = factory({
        manifest: record.manifest,
        translations: record.translations,
        source: source.source,
        context,
        reportFailure: (error, action) =>
          this.reportActivationFailure(record, generation, error, action),
      });
      activation.sandbox = sandbox;
      await sandbox.start();
      if (!this.isActivationCurrent(record, activation)) {
        this.disposeActivation(record, activation);
        return this.cancelledActivation(record);
      }
      record.sandbox = sandbox;
      record.scope = scope;
      activation.sandbox = null;
      activation.scope = null;
      record.status = "enabled";
      record.error = null;
      record.failures = newFailureLog();
      this.persistState(record, true);
      this.publish();
      return { ok: true, status: "enabled" };
    } catch (error) {
      if (!this.isActivationCurrent(record, activation)) {
        this.disposeActivation(record, activation);
        return this.cancelledActivation(record);
      }
      activation.sandbox = null;
      activation.scope = null;
      let failure: unknown = error;
      try {
        sandbox?.dispose();
      } catch (cleanupError) {
        failure = new AggregateError(
          [error, cleanupError],
          "Sandbox activation and cleanup failed",
        );
      }
      try {
        this.disposeRecord(record, scope);
      } catch (cleanupError) {
        failure = new AggregateError(
          [failure, cleanupError],
          "Sandbox activation and host cleanup failed",
        );
      }
      record.sandbox = null;
      record.scope = null;
      record.status = "failed";
      record.error = errorMessage(failure);
      this.persistState(record, false);
      this.publish();
      console.error("[redux.extensions] sandbox activation failed", {
        id: record.manifest.id,
        version: record.manifest.version,
        error: failure,
      });
      return { ok: false, reason: record.error, extensionId: record.manifest.id };
    }
  }

  /** Build the capability-gated context for one activation. */
  private createContext(
    record: ExtensionRecord,
    scope: ExtensionScope,
    translations: ExtensionTranslations | undefined,
    generation?: number,
  ): ExtensionHostContext {
    const manifest = record.manifest;
    const granted = new Set(record.capabilities);
    const add = (cleanup: ExtensionDisposer): ExtensionDisposer => scope.add(cleanup);
    // Values declared through the gated facade belong to this activation. The
    // cleanup runs last (LIFO) so other registrations can still read them while
    // they tear down, and a later enable declares them afresh.
    add(() => valueRegistry.removeOwner(manifest.id));
    add(() => removeExtensionServices(manifest.id));
    let activeSubscriptions = 0;
    let activeScripts = 0;
    let activeStyles = 0;
    const requireCapability = (capability: ExtensionCapability, action: string): void => {
      requireExtensionCapability(granted, capability, action);
    };
    const reportFailure = (error: unknown, action: string): void => {
      if (generation === undefined) {
        this.recordFailure(manifest.id, error, action);
      } else {
        this.reportActivationFailure(record, generation, error, action);
      }
    };
    const subscribe = (
      name: string,
      callback: ExtensionCallback<unknown>,
      priority = 0,
    ): ExtensionDisposer => {
      requireCapability("events", `events.${name}`);
      if (!isExtensionEventName(name)) {
        throw new ExtensionEventNameError(name);
      }
      const wrapped = (payload: unknown): void => {
        try {
          const result: unknown = callback(payload);
          if (result && typeof (result as PromiseLike<unknown>).then === "function") {
            void (result as PromiseLike<unknown>).then(undefined, (error) =>
              reportFailure(error, `events.${name}`),
            );
          }
        } catch (error) {
          reportFailure(error, `events.${name}`);
          throw error;
        }
      };
      if (activeSubscriptions >= MAX_EVENT_SUBSCRIPTIONS) {
        throw new Error(`Extension event subscription limit reached: ${MAX_EVENT_SUBSCRIPTIONS}`);
      }
      const disposer = extensionRegistry.onEvent(name, wrapped, {
        owner: manifest.id,
        priority: Math.max(-1000, Math.min(1000, priority)),
      });
      activeSubscriptions += 1;
      const tracked = () => {
        if (activeSubscriptions > 0) {
          activeSubscriptions -= 1;
        }
        disposer();
      };
      return add(tracked);
    };
    const registerHook = (
      name: string,
      callback: PublicHookHandler,
      schema: PublicHookPayloadSchema,
      priority = 0,
    ): ExtensionDisposer => {
      requireCapability("hooks", `hooks.register.${name}`);
      if (activeSubscriptions >= MAX_EVENT_SUBSCRIPTIONS) {
        throw new Error(`Extension hook subscription limit reached: ${MAX_EVENT_SUBSCRIPTIONS}`);
      }
      const disposer = publicHookRegistry.register(name, callback, {
        owner: manifest.id,
        schema,
        priority,
      });
      activeSubscriptions += 1;
      return add(() => {
        if (activeSubscriptions > 0) {
          activeSubscriptions -= 1;
        }
        disposer();
      });
    };
    const invokeHook = async (
      name: string,
      payload: unknown,
      options?: PublicHookInvokeOptions,
    ) => {
      requireCapability("hooks", `hooks.invoke.${name}`);
      return publicHookRegistry.invoke(name, payload, options);
    };
    /**
     * Own one `theme.subscribe` registration for this activation.
     *
     * Theme listeners share the event subscription budget, are released with
     * the scope, and never expose a cancellation function to package code.
     */
    const subscribeTheme = (listener: () => void): void => {
      if (activeSubscriptions >= MAX_EVENT_SUBSCRIPTIONS) {
        throw new Error(`Extension event subscription limit reached: ${MAX_EVENT_SUBSCRIPTIONS}`);
      }
      const dispose = requireExtensionApi().theme.subscribe(listener);
      activeSubscriptions += 1;
      add(() => {
        if (activeSubscriptions > 0) {
          activeSubscriptions -= 1;
        }
        dispose();
      });
    };
    let gatedApi: ReduxApi | null = null;
    const api = (): ReduxApi => {
      gatedApi ??= gateExtensionApi(requireExtensionApi(), granted, manifest.id, {
        subscribeTheme,
        reportFailure,
      });
      return gatedApi;
    };
    const settingsStore = extensionPreferenceStore(
      PREFERENCE_SECTIONS.settings,
      manifest.id,
      this.preferenceStore,
    );
    const storageStore = extensionPreferenceStore(
      PREFERENCE_SECTIONS.values,
      manifest.id,
      this.preferenceStore,
    );
    const checkStoreKey = (key: unknown): string => {
      if (typeof key !== "string" || !key.length || key.length > MAX_STORE_KEY_LENGTH) {
        throw new TypeError(`Extension store key must be 1-${MAX_STORE_KEY_LENGTH} characters`);
      }
      return key;
    };
    const checkStoreValue = (value: unknown): string => {
      if (typeof value !== "string") {
        throw new TypeError("Extension store values must be strings");
      }
      if (new TextEncoder().encode(value).byteLength > MAX_STORE_VALUE_BYTES) {
        throw new RangeError(`Extension store value exceeds ${MAX_STORE_VALUE_BYTES} bytes`);
      }
      return value;
    };
    const guardedStore = (
      store: ExtensionKeyValueStore,
      capability: ExtensionCapability,
      action: string,
    ): ExtensionKeyValueStore => ({
      get: (key) => {
        requireCapability(capability, `${action}.get`);
        return store.get(checkStoreKey(key));
      },
      set: (key, value) => {
        requireCapability(capability, `${action}.set`);
        store.set(checkStoreKey(key), checkStoreValue(value));
      },
      delete: (key) => {
        requireCapability(capability, `${action}.delete`);
        store.delete(checkStoreKey(key));
      },
      clear: () => {
        requireCapability(capability, `${action}.clear`);
        store.clear();
      },
    });
    const guardedJsonStore = (store: ExtensionKeyValueStore): ExtensionJsonStore => ({
      ...guardedStore(store, "storage", "storage"),
      getJSON: <T>(key: string): T | null => {
        requireCapability("storage", "storage.getJSON");
        return decodeExtensionStorageJson(store.get(checkStoreKey(key))) as T | null;
      },
      setJSON: (key, value) => {
        requireCapability("storage", "storage.setJSON");
        store.set(checkStoreKey(key), encodeExtensionStorageJson(value));
      },
    });
    const services = {
      provide: (definition: Parameters<typeof provideExtensionService>[1]): ExtensionDisposer => {
        requireCapability("services", "services.provide");
        return add(provideExtensionService(manifest.id, definition));
      },
      resolve: (id: string, version?: string) => {
        requireCapability("services", "services.resolve");
        return resolveExtensionService(manifest.id, id, version);
      },
      call: (id: string, method: string, args?: readonly unknown[]) => {
        requireCapability("services", "services.call");
        return callExtensionService(manifest.id, id, method, args);
      },
      onChange: (id: string, listener: Parameters<typeof subscribeExtensionService>[2]) => {
        requireCapability("services", "services.onChange");
        return add(subscribeExtensionService(manifest.id, id, listener));
      },
      provideData: (definition: Parameters<typeof provideExtensionData>[1]): ExtensionDisposer => {
        requireCapability("services", "services.provideData");
        return add(provideExtensionData(manifest.id, definition));
      },
      readData: <T = unknown>(id: string, version?: string) => {
        requireCapability("services", "services.readData");
        return readExtensionData(manifest.id, id, version) as ExtensionDataInfo<T> | null;
      },
      updateData: (id: string, value: unknown) => {
        requireCapability("services", "services.updateData");
        updateExtensionData(manifest.id, id, value);
      },
      onDataChange: <T = unknown>(
        id: string,
        listener: (info: ExtensionDataInfo<T> | null) => void,
      ) => {
        requireCapability("services", "services.onDataChange");
        return add(
          subscribeExtensionData(
            manifest.id,
            id,
            listener as Parameters<typeof subscribeExtensionData>[2],
          ),
        );
      },
    };
    return {
      manifest,
      signal: scope.controller.signal,
      get api() {
        return api();
      },
      i18n: createExtensionI18n(manifest.id, translations),
      ui: createExtensionUiContext(manifest, translations, scope.controller.signal, granted),
      events: { on: (name, callback, priority) => subscribe(name, callback, priority) },
      hooks: { register: registerHook, invoke: invokeHook },
      scripts: {
        register: (definition) => {
          requireCapability("scripts", "scripts.register");
          if (activeScripts >= MAX_EXTENSION_SCRIPTS) {
            throw new Error(`Extension script limit reached: ${MAX_EXTENSION_SCRIPTS}`);
          }
          const dispose = scriptRegistry.register(
            manifest.id,
            manifest,
            definition,
            scope.controller.signal,
            translations,
            api,
            (error, action) => reportFailure(error, action),
          );
          activeScripts += 1;
          const tracked = () => {
            if (activeScripts > 0) {
              activeScripts -= 1;
            }
            dispose();
          };
          return add(tracked);
        },
      },
      settings: guardedStore(settingsStore, "settings", "settings"),
      storage: guardedJsonStore(storageStore),
      services,
      timers: (() => {
        const timeouts = new Set<ReturnType<typeof globalThis.setTimeout>>();
        const intervals = new Set<ReturnType<typeof globalThis.setInterval>>();
        const animationFrames = new Set<number>();
        const timerCount = () => timeouts.size + intervals.size + animationFrames.size;
        const clampDelay = (delay: number, minimum: number): number =>
          Number.isFinite(delay) ? Math.max(minimum, Math.min(delay, 2_147_483_647)) : minimum;
        const reportTimerFailure = (action: string, error: unknown): void => {
          reportFailure(error, action);
        };
        add(() => {
          for (const handle of timeouts) {
            this.timers.clearTimeout?.(handle);
          }
          for (const handle of intervals) {
            this.timers.clearInterval?.(handle);
          }
          for (const handle of animationFrames) {
            (this.timers.cancelAnimationFrame ?? globalThis.cancelAnimationFrame)(handle);
          }
          timeouts.clear();
          intervals.clear();
          animationFrames.clear();
        });
        const requireTimerSlot = (): void => {
          if (timerCount() >= MAX_TIMER_HANDLES) {
            throw new Error(`Extension timer limit reached: ${MAX_TIMER_HANDLES}`);
          }
        };
        return {
          setTimeout: (callback, delay) => {
            requireCapability("timers", "timers.setTimeout");
            requireTimerSlot();
            const slot: { handle?: ReturnType<typeof globalThis.setTimeout> } = {};
            const handle = this.timers.setTimeout(
              () => {
                if (slot.handle !== undefined) {
                  timeouts.delete(slot.handle);
                }
                try {
                  callback();
                } catch (error) {
                  reportTimerFailure("timers.setTimeout", error);
                }
              },
              clampDelay(delay, 0),
            );
            slot.handle = handle;
            timeouts.add(handle);
            return handle;
          },
          clearTimeout: (handle) => {
            requireCapability("timers", "timers.clearTimeout");
            timeouts.delete(handle);
            this.timers.clearTimeout?.(handle);
          },
          setInterval: (callback, delay) => {
            requireCapability("timers", "timers.setInterval");
            requireTimerSlot();
            const handle = this.timers.setInterval(
              () => {
                try {
                  callback();
                } catch (error) {
                  reportTimerFailure("timers.setInterval", error);
                }
              },
              clampDelay(delay, MIN_INTERVAL_MS),
            );
            intervals.add(handle);
            return handle;
          },
          clearInterval: (handle) => {
            requireCapability("timers", "timers.clearInterval");
            intervals.delete(handle);
            this.timers.clearInterval?.(handle);
          },
          requestAnimationFrame: (callback) => {
            requireCapability("timers", "timers.requestAnimationFrame");
            requireTimerSlot();
            let handle = 0;
            const wrapped: FrameRequestCallback = (time) => {
              animationFrames.delete(handle);
              try {
                callback(time);
              } catch (error) {
                reportTimerFailure("timers.requestAnimationFrame", error);
              }
            };
            handle =
              this.timers.requestAnimationFrame?.(wrapped) ??
              globalThis.requestAnimationFrame(wrapped);
            animationFrames.add(handle);
            return handle;
          },
          cancelAnimationFrame: (handle) => {
            requireCapability("timers", "timers.cancelAnimationFrame");
            animationFrames.delete(handle);
            (this.timers.cancelAnimationFrame ?? globalThis.cancelAnimationFrame)(handle);
          },
        };
      })(),
      styles: {
        add: (cssText) => {
          requireCapability("styles", "styles.add");
          if (typeof cssText !== "string" || !cssText.trim()) {
            throw new TypeError("Extension style must be a non-empty string");
          }
          if (new TextEncoder().encode(cssText).byteLength > MAX_STYLE_BYTES) {
            throw new RangeError(`Extension style exceeds ${MAX_STYLE_BYTES} bytes`);
          }
          if (activeStyles >= MAX_EXTENSION_STYLES) {
            throw new Error(`Extension style limit reached: ${MAX_EXTENSION_STYLES}`);
          }
          const dispose = this.styleHost?.add(cssText, manifest.id) ?? (() => {});
          activeStyles += 1;
          const tracked = () => {
            if (activeStyles > 0) {
              activeStyles -= 1;
            }
            dispose();
          };
          return add(tracked);
        },
      },
      addCleanup: add,
    };
  }

  /** Dispose the sandbox, scope cleanups, and owner registrations. */
  private disposeRecord(record: ExtensionRecord, scope: ExtensionScope, purge = false): void {
    try {
      record.sandbox?.dispose();
    } finally {
      record.sandbox = null;
      // Values forget their owner as soon as the scope cleanup runs, so their
      // persisted entries must be removed while the definitions are still present.
      if (purge) {
        valueRegistry.purgeOwner(record.manifest.id);
      }
      try {
        scope.dispose();
      } finally {
        extensionRegistry.removeOwner(record.manifest.id);
        if (purge) {
          settingsRegistry.purgeOwner(record.manifest.id);
        } else {
          settingsRegistry.unregisterOwner(record.manifest.id);
          valueRegistry.removeOwner(record.manifest.id);
        }
      }
    }
  }

  /** True when at least one package is currently enabled. */
  hasEnabled(): boolean {
    for (const record of this.records.values()) {
      if (record.status === "enabled") {
        return true;
      }
    }
    return false;
  }
}

/** The application-wide runtime; host entry points share this instance. */
export const extensionRuntime = new ExtensionRuntime();

// Extensions resolve activation-time text once. A language switch rebuilds the
// enabled packages so their panels, sidebars, and overlays follow the UI.
let extensionLanguage = getLanguage();
onLanguageChange((language) => {
  if (language === extensionLanguage) {
    return;
  }
  extensionLanguage = language;
  void extensionRuntime.reloadEnabled();
});

/** Canonical context type for a sandboxed Extension entry. */
export type TrustedExtensionContext = SandboxExtensionContext;
