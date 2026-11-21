/* eslint-disable max-lines -- manifest validation, persistence, and data-only definitions share one support module. */
/**
 * Persistence and manifest helpers behind the extension runtime.
 *
 * Provides scoped disposers, the stored extension order and state, the one-shot
 * safe-mode request, startup diagnostics, manifest materialisation and
 * validation, and data-only definitions.
 */
import {
  PREFERENCE_SECTIONS,
  type PreferenceSection,
  type PreferenceStore,
} from "../state/preferences.ts";
import { isRecord } from "../utils/guards.ts";
import { isVersionRange, satisfiesVersionRange } from "../utils/version.ts";
import { t } from "../../i18n/index.ts";
import type {
  ExtensionKeyValueStore,
  ExtensionOperationErrorCode,
  ExtensionOperationResult,
  ExtensionStatusSnapshot,
  TrustedExtensionManifest,
  TrustedExtensionDefinition,
} from "./extensionRuntime.ts";
import type { ExtensionDisposer } from "./registry.ts";
import type { ExtensionTranslations } from "./i18n.ts";
import type { Shortcut } from "../shortcuts/types.ts";
import {
  EXTENSION_CAPABILITIES,
  isExtensionCapability,
  type ExtensionCapability,
} from "./capabilities.ts";
import { isSafeAssetPath, MAX_ASSETS } from "./assets.ts";

/** One package lifetime: its abort signal and reverse-ordered cleanups. */
export class ExtensionScope {
  readonly controller = new AbortController();
  private readonly cleanups: ExtensionDisposer[] = [];
  private disposed = false;

  /** Track one cleanup; a scope that is already disposed runs it immediately. */
  add(cleanup: ExtensionDisposer): ExtensionDisposer {
    if (this.disposed) {
      cleanup();
      return cleanup;
    }
    let active = true;
    const disposer = () => {
      if (!active) {
        return;
      }
      active = false;
      cleanup();
    };
    this.cleanups.push(disposer);
    return disposer;
  }

  /** Abort the scope, run every cleanup in reverse, and aggregate their errors. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.controller.abort();
    const errors: unknown[] = [];
    for (const cleanup of [...this.cleanups].reverse()) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    this.cleanups.length = 0;
    if (errors.length) {
      throw new AggregateError(errors, "Extension cleanup failed");
    }
  }
}

const EXTENSION_STORE_PREFIX = "extension";
const LEGACY_STORE_PREFIX = "mod";

/**
 * Move an owner's stored values from the legacy prefix to the Extension prefix.
 *
 * Reads migrate lazily: the first read after upgrade rewrites every matching
 * key once, so an installed package keeps its settings and values across the
 * rename. Keys already written under the Extension prefix win.
 */
function migrateStoreValues(
  section: PreferenceSection,
  extensionId: string,
  store: PreferenceStore,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const prefix = `${EXTENSION_STORE_PREFIX}:${extensionId}:`;
  const legacyPrefix = `${LEGACY_STORE_PREFIX}:${extensionId}:`;
  let migrated = false;
  const next = { ...values };
  for (const key of Object.keys(values)) {
    if (!key.startsWith(legacyPrefix)) {
      continue;
    }
    const currentKey = `${prefix}${key.slice(legacyPrefix.length)}`;
    if (!(currentKey in next)) {
      next[currentKey] = values[key];
    }
    delete next[key];
    migrated = true;
  }
  if (migrated) {
    store.write(section, next);
  }
  return next;
}

/** Owner-scoped string view over one preference section. */
export function extensionPreferenceStore(
  section: PreferenceSection,
  extensionId: string,
  store: PreferenceStore,
): ExtensionKeyValueStore {
  const prefix = `${EXTENSION_STORE_PREFIX}:${extensionId}:`;
  const legacyPrefix = `${LEGACY_STORE_PREFIX}:${extensionId}:`;
  const read = (): Record<string, unknown> => {
    const value = store.read(section, null);
    return migrateStoreValues(section, extensionId, store, isRecord(value) ? value : {});
  };
  return {
    get(key) {
      const value = read()[`${prefix}${key}`];
      return typeof value === "string" ? value : value === undefined ? null : JSON.stringify(value);
    },
    set(key, value) {
      const values = read();
      delete values[`${legacyPrefix}${key}`];
      store.write(section, { ...values, [`${prefix}${key}`]: value });
    },
    delete(key) {
      const values = read();
      delete values[`${prefix}${key}`];
      delete values[`${legacyPrefix}${key}`];
      store.write(section, values);
    },
    clear() {
      const values = read();
      for (const key of Object.keys(values)) {
        if (key.startsWith(prefix) || key.startsWith(legacyPrefix)) {
          delete values[key];
        }
      }
      store.write(section, values);
    },
  };
}

/** Consent and enablement stored for one extension version. */
export interface PersistedExtensionState {
  acknowledged: boolean;
  enabled: boolean;
  /**
   * The fingerprint the acknowledgement was given for. A missing or non-string
   * stored value reads as `null` and counts as unconfirmed consent.
   */
  fingerprint: string | null;
}

/** Persistence key for one extension id and version. */
function stateKey(manifest: TrustedExtensionManifest): string {
  return `extension:${manifest.id}@${manifest.version}`;
}

/** Legacy persistence key adopted from before the Extension rename. */
function legacyStateKey(manifest: TrustedExtensionManifest): string {
  return `mod:${manifest.id}@${manifest.version}`;
}

const EXTENSION_ORDER_KEY = "extension:order";
const LEGACY_ORDER_KEY = "mod:order";
const EXTENSION_BOOT_KEY = "extension:boot";
const LEGACY_BOOT_KEY = "mod:boot";
const EXTENSION_SAFE_MODE_REQUEST_KEY = "extension:safe-mode-request";
/**
 * Mirror-only copy of the one-shot request.
 *
 * `PreferenceStore.attach()` may replace the whole settings section with the
 * durable document before the next launch reads the request. The mirror copy is
 * outside that document, so the request survives that reconciliation.
 */
const EXTENSION_SAFE_MODE_REQUEST_MIRROR_KEY = "redux:extension-safe-mode-request";

/** One read of the settings section shared by every extension preference. */
function readSettingsSection(store: PreferenceStore): Record<string, unknown> {
  const section = store.read<unknown>(PREFERENCE_SECTIONS.settings, null);
  return isRecord(section) ? section : {};
}

/**
 * Read one extension state key, adopting a legacy `mod:` key on first contact.
 * The migrated value is written under the Extension key and the legacy entry
 * is removed.
 */
function readSettingsKey(store: PreferenceStore, key: string, legacyKey?: string): unknown {
  const section = readSettingsSection(store);
  if (key in section) {
    return section[key];
  }
  if (legacyKey === undefined || !(legacyKey in section)) {
    return undefined;
  }
  const value = section[legacyKey];
  const next = { ...section, [key]: value };
  delete next[legacyKey];
  store.write(PREFERENCE_SECTIONS.settings, next);
  return value;
}

/** Write one key while preserving the rest of the settings section. */
function writeSettingsKey(
  store: PreferenceStore,
  key: string,
  value: unknown,
  legacyKey?: string,
): void {
  const section = { ...readSettingsSection(store), [key]: value };
  if (legacyKey !== undefined) {
    delete section[legacyKey];
  }
  store.write(PREFERENCE_SECTIONS.settings, section);
}

/** Remove one key and its legacy spelling, leaving the section untouched when absent. */
function clearSettingsKey(store: PreferenceStore, key: string, legacyKey?: string): void {
  const section = readSettingsSection(store);
  if (!(key in section) && (legacyKey === undefined || !(legacyKey in section))) {
    return;
  }
  const next = { ...section };
  delete next[key];
  if (legacyKey !== undefined) {
    delete next[legacyKey];
  }
  store.write(PREFERENCE_SECTIONS.settings, next);
}

/** Persisted extension ids, in the order their modules should activate. */
export function readExtensionOrder(store: PreferenceStore): string[] {
  const value = readSettingsKey(store, EXTENSION_ORDER_KEY, LEGACY_ORDER_KEY);
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/** Persist the activation order with duplicates removed. */
export function writeExtensionOrder(ids: readonly string[], store: PreferenceStore): void {
  writeSettingsKey(store, EXTENSION_ORDER_KEY, [...new Set(ids)], LEGACY_ORDER_KEY);
}

/** Remove one id from the persisted activation order, if present. */
export function removeExtensionOrder(id: string, store: PreferenceStore): void {
  const order = readExtensionOrder(store);
  if (!order.includes(id)) {
    return;
  }
  writeExtensionOrder(
    order.filter((candidate) => candidate !== id),
    store,
  );
}

/** Identifies an activation pass that started and did not finish. */
export interface ExtensionBootMarker {
  readonly id: string;
  readonly at: number;
}

/** Read the marker for an unfinished activation pass, or null when none exists. */
export function readExtensionBootMarker(store: PreferenceStore): ExtensionBootMarker | null {
  const value = readSettingsKey(store, EXTENSION_BOOT_KEY, LEGACY_BOOT_KEY);
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.at !== "number") {
    return null;
  }
  return { id: value.id, at: value.at };
}

/** Mark one activation pass before evaluating entries; remove it on success. */
export function writeExtensionBootMarker(id: string, store: PreferenceStore): void {
  writeSettingsKey(store, EXTENSION_BOOT_KEY, { id, at: Date.now() }, LEGACY_BOOT_KEY);
}

/** Clear the boot marker once an activation pass completes. */
export function clearExtensionBootMarker(store: PreferenceStore): void {
  clearSettingsKey(store, EXTENSION_BOOT_KEY, LEGACY_BOOT_KEY);
}

/** A one-shot request to start the next launch without Extension code. */
export interface ExtensionSafeModeRequest {
  readonly at: number;
}

/** Read one stored request value, rejecting malformed or non-finite timestamps. */
function safeModeRequestOf(value: unknown): ExtensionSafeModeRequest | null {
  if (!isRecord(value) || typeof value.at !== "number" || !Number.isFinite(value.at)) {
    return null;
  }
  return { at: value.at };
}

/** Read the mirror copy that survives a settings-section reconciliation. */
function readSafeModeRequestMirror(store: PreferenceStore): ExtensionSafeModeRequest | null {
  try {
    const raw = store.mirror.getItem(EXTENSION_SAFE_MODE_REQUEST_MIRROR_KEY);
    if (typeof raw !== "string" || raw.length === 0) {
      return null;
    }
    return safeModeRequestOf(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** Read the one-shot safe-mode request, if one is pending. */
export function readExtensionSafeModeRequest(
  store: PreferenceStore,
): ExtensionSafeModeRequest | null {
  return (
    safeModeRequestOf(readSettingsKey(store, EXTENSION_SAFE_MODE_REQUEST_KEY)) ??
    readSafeModeRequestMirror(store)
  );
}

/** Record a one-shot safe-mode request for the next launch. */
export function writeExtensionSafeModeRequest(store: PreferenceStore): ExtensionSafeModeRequest {
  const request = Object.freeze({ at: Date.now() });
  writeSettingsKey(store, EXTENSION_SAFE_MODE_REQUEST_KEY, request);
  try {
    store.mirror.setItem(EXTENSION_SAFE_MODE_REQUEST_MIRROR_KEY, JSON.stringify(request));
  } catch {
    // A full or disabled mirror must not prevent the settings write.
  }
  return request;
}

/** Remove both stored copies of the one-shot safe-mode request. */
export function clearExtensionSafeModeRequest(store: PreferenceStore): void {
  clearSettingsKey(store, EXTENSION_SAFE_MODE_REQUEST_KEY);
  try {
    store.mirror.setItem(EXTENSION_SAFE_MODE_REQUEST_MIRROR_KEY, "");
  } catch {
    // The settings key is already cleared; a throwing mirror has nothing left to remove.
  }
}

/** Read and clear the request so exactly one launch observes it. */
export function consumeExtensionSafeModeRequest(
  store: PreferenceStore,
): ExtensionSafeModeRequest | null {
  const request = readExtensionSafeModeRequest(store);
  clearExtensionSafeModeRequest(store);
  return request;
}

/** One Extension that failed during a startup pass. */
export interface ExtensionStartupFailure {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly message: string;
}

/** One Extension that registered or activated during a startup pass. */
export interface ExtensionStartupActivation {
  readonly id: string;
  readonly name: string;
  readonly version: string;
}

/** Extension evidence collected by one startup pass. */
export interface ExtensionStartupDiagnostics {
  readonly failures: readonly ExtensionStartupFailure[];
  readonly activations: readonly ExtensionStartupActivation[];
}

/** Empty startup evidence shared by a reset and a host with no packages. */
export const EMPTY_EXTENSION_STARTUP_DIAGNOSTICS: ExtensionStartupDiagnostics = Object.freeze({
  failures: Object.freeze([]),
  activations: Object.freeze([]),
});

/**
 * Turn one startup pass's operation results and runtime snapshots into
 * display-ready failures and candidate activations.
 *
 * A failed result names the package it belongs to; `extensionId` is the only
 * identity the operation result carries, so the snapshot supplies the display
 * name and version when the package registered. Snapshots that did not fail
 * count as loaded evidence, including packages that registered but stayed
 * disabled. Results without an `extensionId` cannot name a package and are
 * skipped.
 */
export function summarizeExtensionStartup(
  results: readonly ExtensionOperationResult[],
  snapshots: readonly ExtensionStatusSnapshot[],
): ExtensionStartupDiagnostics {
  const byId = new Map(snapshots.map((snapshot) => [snapshot.manifest.id, snapshot]));
  const failedIds = new Set<string>();
  const failures: ExtensionStartupFailure[] = [];
  for (const result of results) {
    if (result.ok || !result.extensionId || failedIds.has(result.extensionId)) {
      continue;
    }
    failedIds.add(result.extensionId);
    const snapshot = byId.get(result.extensionId);
    failures.push(
      Object.freeze({
        id: result.extensionId,
        name: snapshot?.manifest.name ?? result.extensionId,
        version: snapshot?.manifest.version ?? "",
        message: result.reason,
      }),
    );
  }
  const activations = snapshots
    .filter((snapshot) => snapshot.status !== "failed" && !failedIds.has(snapshot.manifest.id))
    .map((snapshot) =>
      Object.freeze({
        id: snapshot.manifest.id,
        name: snapshot.manifest.name,
        version: snapshot.manifest.version,
      }),
    );
  return Object.freeze({
    failures: Object.freeze(failures),
    activations: Object.freeze(activations),
  });
}

/** Whether the user has ever made a consent/disable choice for these bytes. */
export function hasPersistedExtensionState(
  manifest: TrustedExtensionManifest,
  store: PreferenceStore,
): boolean {
  return readSettingsKey(store, stateKey(manifest), legacyStateKey(manifest)) !== undefined;
}

/** Whether any stored version of this id was acknowledged and then disabled. */
export function hasDisabledExtensionVersion(
  manifest: TrustedExtensionManifest,
  store: PreferenceStore,
): boolean {
  const prefixes = [`extension:${manifest.id}@`, `mod:${manifest.id}@`];
  return Object.entries(readSettingsSection(store)).some(
    ([key, value]) =>
      prefixes.some((prefix) => key.startsWith(prefix)) &&
      isRecord(value) &&
      value.acknowledged === true &&
      value.enabled === false,
  );
}

/** Read one version's consent and enablement, normalizing missing fields. */
export function readPersistedExtensionState(
  manifest: TrustedExtensionManifest,
  store: PreferenceStore,
): PersistedExtensionState {
  const value = readSettingsKey(store, stateKey(manifest), legacyStateKey(manifest));
  const persisted = isRecord(value) ? value : {};
  return {
    acknowledged: persisted.acknowledged === true,
    enabled: persisted.enabled === true,
    fingerprint: typeof persisted.fingerprint === "string" ? persisted.fingerprint : null,
  };
}

/** Persist one version's consent and enablement. */
export function writePersistedExtensionState(
  manifest: TrustedExtensionManifest,
  state: PersistedExtensionState,
  store: PreferenceStore,
): void {
  writeSettingsKey(store, stateKey(manifest), state, legacyStateKey(manifest));
}

/** Drop one version's persisted consent and enablement. */
export function clearPersistedExtensionState(
  manifest: TrustedExtensionManifest,
  store: PreferenceStore,
): void {
  clearSettingsKey(store, stateKey(manifest), legacyStateKey(manifest));
}

/** Warnings already written for one manifest identity. */
const warnedManifestIssues = new Set<string>();

/** Write one deprecation warning per manifest and issue. */
function warnManifestIssue(
  manifest: TrustedExtensionManifest,
  issue: string,
  message: string,
  detail: Record<string, unknown>,
): void {
  const key = `${issue}:${manifest.id}@${manifest.version}`;
  if (warnedManifestIssues.has(key)) {
    return;
  }
  warnedManifestIssues.add(key);
  console.warn(`[redux.extensions] ${message}`, {
    id: manifest.id,
    version: manifest.version,
    ...detail,
  });
}

/**
 * Make the implicit `scripts` grant of a data-only package explicit.
 *
 * Older data-only manifests could omit `scripts`; the runtime still required it
 * at activation, so such a package validated and then failed. The host now adds
 * the grant and records a deprecation warning instead of rejecting the package.
 * Declaring `scripts` remains the documented form.
 */
function withImplicitCapabilities(manifest: TrustedExtensionManifest): TrustedExtensionManifest {
  const declared = Array.isArray(manifest.capabilities) ? manifest.capabilities : null;
  if (declared === null && manifest.capabilities !== undefined) {
    // A malformed declaration is rejected by validateManifest; do not replace it.
    return manifest;
  }
  let capabilities: readonly ExtensionCapability[] = declared ?? [];
  let next = manifest;
  if (
    manifest.entry === undefined &&
    hasDeclarativeScripts(manifest) &&
    !capabilities.includes("scripts")
  ) {
    warnManifestIssue(
      manifest,
      "data-only-scripts",
      "data-only package omits the implicit scripts capability; add it to capabilities",
      { capability: "scripts" },
    );
    capabilities = Object.freeze([...capabilities, "scripts"]);
    next = { ...next, capabilities };
  }
  if (capabilities.includes("host.patch")) {
    warnManifestIssue(manifest, "host.patch", "host.patch is deprecated and grants no handle", {
      capability: "host.patch",
    });
    // Keep the declaration loadable but never hand the gate a grant that has no
    // positive check. A future major can reject the name outright.
    capabilities = Object.freeze(capabilities.filter((entry) => entry !== "host.patch"));
    next = { ...next, capabilities };
  }
  return next;
}

/** Attach entry translations and fill the display name from English when absent. */
export function materializeManifest(
  manifest: TrustedExtensionManifest,
  translations: ExtensionTranslations | undefined,
): TrustedExtensionManifest {
  const withTranslations = withImplicitCapabilities(
    translations !== undefined && translations !== manifest.translations
      ? { ...manifest, translations }
      : manifest,
  );
  if (typeof withTranslations.name === "string") {
    return withTranslations;
  }
  const translatedName = translations?.en?.name;
  return translatedName === undefined
    ? withTranslations
    : { ...withTranslations, name: translatedName };
}

/** The name shown while registering a package's translation catalog. */
export function registrationName(
  manifest: TrustedExtensionManifest,
  translations: ExtensionTranslations | undefined,
) {
  return translations === undefined ? (manifest.name ?? { key: "name" }) : { key: "name" };
}

/** Readable text from any thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DEFAULT_I18N_FILE = "i18n.json";

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Accept a relative `.json` path with no empty, `.` or `..` segments. */
function isSafePackageFilePath(value: string): boolean {
  if (
    !value ||
    utf8ByteLength(value) > 256 ||
    !value.endsWith(".json") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** Build the localized error for a rejected translation declaration. */
function invalidTranslations(value: unknown): {
  reason: string;
  code: ExtensionOperationErrorCode;
  value: string;
} {
  const displayValue = typeof value === "string" ? value : String(value);
  return {
    reason: t("settings.extensions.error.invalidTranslations", { value: displayValue }),
    code: "invalidTranslations",
    value: displayValue,
  };
}

/** Require string catalogs with an English name and description. */
function validateTranslationShape(translations: unknown): {
  value: string;
} | null {
  if (!isRecord(translations)) {
    return { value: "translations" };
  }
  const languages = Object.entries(translations);
  if (!Object.hasOwn(translations, "en")) {
    return { value: "translations.en" };
  }
  for (const [language, catalog] of languages) {
    if (!isRecord(catalog)) {
      return { value: `translations.${language}` };
    }
    for (const [key, text] of Object.entries(catalog)) {
      if (key.startsWith("extension.") || key.startsWith("extension::")) {
        return { value: `translations.${language}.${key}` };
      }
      if (typeof text !== "string") {
        return { value: `translations.${language}.${key}` };
      }
    }
  }
  const english = translations.en;
  if (!isRecord(english)) {
    return { value: "translations.en" };
  }
  // English catalogs may use canonical keys or legacy `mod.`-prefixed spellings.
  const hasName = typeof english.name === "string" || typeof english["mod.name"] === "string";
  const hasDescription =
    typeof english.description === "string" || typeof english["mod.description"] === "string";
  if (!hasName) {
    return { value: "translations.en.name" };
  }
  if (!hasDescription) {
    return { value: "translations.en.description" };
  }
  return null;
}

/** Render a numeric or dotted host version as a full dotted string. */
function hostVersionText(hostVersion: string | number): string {
  return typeof hostVersion === "number" ? `${hostVersion}.0.0` : hostVersion;
}

/** Extract the host major from a numeric or dotted version. */
function hostMajorOf(hostVersion: string | number): number {
  if (typeof hostVersion === "number") {
    return hostVersion;
  }
  const match = /^(\d+)\./u.exec(hostVersion.trim());
  return match ? Number(match[1]) : 0;
}

/** Build the localized error for a missing or incompatible host version. */
function incompatibleHostVersion(
  required: unknown,
  hostVersion: string | number,
): { reason: string; code: ExtensionOperationErrorCode; value: string } {
  const declared =
    (typeof required === "number" && Number.isInteger(required)) || typeof required === "string"
      ? String(required)
      : "none";
  return {
    reason: t("settings.extensions.error.incompatibleHostVersion", {
      required: declared,
      version: hostVersionText(hostVersion),
    }),
    code: "incompatibleHostVersion",
    value: declared,
  };
}

/** Build the localized error for an unparsable version range. */
function invalidHostVersionRange(
  required: string,
  hostVersion: string | number,
): { reason: string; code: ExtensionOperationErrorCode; value: string } {
  return {
    reason: t("settings.extensions.error.invalidHostVersionRange", {
      required,
      version: hostVersionText(hostVersion),
    }),
    code: "invalidHostVersionRange",
    value: required,
  };
}

const PROVENANCE_URL_FIELDS = ["sourceUrl", "homepage", "repository"] as const;
const PROVENANCE_TEXT_FIELDS = [
  { field: "license", limit: 300 },
  { field: "author", limit: 120 },
] as const;

/** Build the localized error for a malformed provenance field. */
function invalidProvenance(value: string): {
  reason: string;
  code: ExtensionOperationErrorCode;
  value: string;
} {
  return {
    reason: t("settings.extensions.error.invalidProvenance", { value }),
    code: "invalidProvenance",
    value,
  };
}

/** Provenance is shape-checked only; it never contributes to trust. */
function validateProvenance(
  manifest: TrustedExtensionManifest,
): { reason: string; code: ExtensionOperationErrorCode; value?: string } | null {
  for (const field of PROVENANCE_URL_FIELDS) {
    const value = manifest[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "string" || value.length > 300 || !/^https?:\/\/\S+$/i.test(value)) {
      return invalidProvenance(`${field}: ${typeof value === "string" ? value : String(value)}`);
    }
  }
  for (const { field, limit } of PROVENANCE_TEXT_FIELDS) {
    const value = manifest[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "string" || value.trim().length === 0 || value.length > limit) {
      return invalidProvenance(field);
    }
  }
  return null;
}

/** Freeze the metadata object the runtime hands back to a package. */
export function freezeManifest(manifest: TrustedExtensionManifest): TrustedExtensionManifest {
  const freeze = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        freeze(entry);
      }
      return Object.freeze(value);
    }
    if (isRecord(value)) {
      for (const entry of Object.values(value)) {
        freeze(entry);
      }
      return Object.freeze(value);
    }
    return value;
  };
  return freeze(manifest) as TrustedExtensionManifest;
}

/** Build the localized error for an invalid capability declaration. */
function invalidCapabilities(value: unknown): {
  reason: string;
  code: ExtensionOperationErrorCode;
  value: string;
} {
  return {
    reason: `Extension capabilities are invalid: ${String(value)}`,
    code: "invalidCapabilities",
    value: String(value),
  };
}

/** Build the error for an invalid package asset map. */
function invalidAssets(value: unknown): {
  reason: string;
  code: ExtensionOperationErrorCode;
  value: string;
} {
  return {
    reason: `Extension assets are invalid: ${String(value)}`,
    code: "invalidAssets",
    value: String(value),
  };
}

/** Build the localized error for an unknown collaboration scope. */
function invalidCollaboration(value: unknown): {
  reason: string;
  code: ExtensionOperationErrorCode;
  value: string;
} {
  const displayValue = String(value);
  return {
    reason: t("settings.extensions.error.invalidCollaboration", { value: displayValue }),
    code: "invalidCollaboration",
    value: displayValue,
  };
}

/** Reject unknown, duplicate, or oversized capability declarations. */
function validateCapabilities(manifest: TrustedExtensionManifest): {
  reason: string;
  code: ExtensionOperationErrorCode;
  value: string;
} | null {
  if (manifest.capabilities === undefined) {
    return null;
  }
  if (!Array.isArray(manifest.capabilities)) {
    return invalidCapabilities(manifest.capabilities);
  }
  if (manifest.capabilities.length > EXTENSION_CAPABILITIES.length) {
    return invalidCapabilities(manifest.capabilities.join(", "));
  }
  const seen = new Set<string>();
  for (const capability of manifest.capabilities) {
    if (!isExtensionCapability(capability)) {
      return invalidCapabilities(String(capability));
    }
    if (seen.has(capability)) {
      return invalidCapabilities(`duplicate: ${capability}`);
    }
    seen.add(capability);
  }
  return null;
}

/**
 * Validate a manifest against the host version.
 *
 * A numeric `engines` value compares the host major; a string is a semver range
 * over the full host version. Returns null when the declaration is acceptable,
 * or a localized reason with the matching stable error code.
 */
export function validateManifest(
  manifest: TrustedExtensionManifest,
  hostVersion: string | number,
): { reason: string; code: ExtensionOperationErrorCode; value?: string } | null {
  if (!manifest || typeof manifest !== "object") {
    return { reason: "Extension manifest is required", code: "manifestRequired" };
  }
  if (typeof manifest.id !== "string" || !/^[a-z][a-z0-9._-]{1,63}$/.test(manifest.id)) {
    return {
      reason:
        "Extension id must start with a lowercase letter and contain only lowercase letters, digits, dots, underscores, or hyphens",
      code: "invalidId",
    };
  }
  if (
    typeof manifest.name !== "string" ||
    typeof manifest.version !== "string" ||
    !manifest.name.trim() ||
    !manifest.version.trim()
  ) {
    return { reason: "Extension name and version are required", code: "nameVersionRequired" };
  }
  const kind = (manifest as unknown as { kind?: unknown }).kind;
  if (kind !== undefined) {
    if (kind !== "extension" && kind !== "mod" && kind !== "data-only" && kind !== "script") {
      return {
        reason: `Extension kind is invalid: ${String(kind)}`,
        code: "invalidKind",
        value: String(kind),
      };
    }
    if (
      kind === "data-only" &&
      (manifest.entry !== undefined || !hasDeclarativeScripts(manifest))
    ) {
      return {
        reason: 'Extension kind "data-only" requires declarative scripts and no entry',
        code: "kindMismatch",
        value: kind,
      };
    }
    if (kind === "script" && manifest.entry === undefined) {
      return {
        reason: 'Extension kind "script" requires an entry module',
        code: "kindMismatch",
        value: kind,
      };
    }
  }
  const collaboration = (manifest as unknown as { collaboration?: unknown }).collaboration;
  if (
    collaboration !== undefined &&
    collaboration !== "local" &&
    collaboration !== "chart" &&
    collaboration !== "shared-service"
  ) {
    return invalidCollaboration(collaboration);
  }
  const engines = (manifest as unknown as { engines?: unknown }).engines;
  const declared = isRecord(engines) ? engines["rpe-redux"] : undefined;
  if (typeof declared === "number") {
    if (!Number.isInteger(declared) || declared !== hostMajorOf(hostVersion)) {
      return incompatibleHostVersion(declared, hostVersion);
    }
  } else if (typeof declared === "string") {
    if (!isVersionRange(declared)) {
      return invalidHostVersionRange(declared, hostVersion);
    }
    if (!satisfiesVersionRange(hostVersionText(hostVersion), declared)) {
      return incompatibleHostVersion(declared, hostVersion);
    }
  } else {
    return incompatibleHostVersion(declared, hostVersion);
  }
  const provenanceError = validateProvenance(manifest);
  if (provenanceError) {
    return provenanceError;
  }
  const capabilityError = validateCapabilities(manifest);
  if (capabilityError) {
    return capabilityError;
  }
  const i18nValue = (manifest as unknown as { i18n?: unknown }).i18n;
  if (i18nValue !== undefined) {
    if (typeof i18nValue !== "string" || !isSafePackageFilePath(i18nValue)) {
      return invalidTranslations(i18nValue);
    }
  } else if (!isSafePackageFilePath(DEFAULT_I18N_FILE)) {
    return invalidTranslations(DEFAULT_I18N_FILE);
  }
  if (manifest.translations !== undefined) {
    const translationError = validateTranslationShape(manifest.translations);
    if (translationError) {
      return invalidTranslations(translationError.value);
    }
  }
  if (manifest.assets !== undefined) {
    if (!isRecord(manifest.assets)) {
      return invalidAssets(manifest.assets);
    }
    const entries = Object.entries(manifest.assets);
    if (entries.length === 0 || entries.length > MAX_ASSETS) {
      return invalidAssets(`asset count ${entries.length}`);
    }
    const paths = new Set<string>();
    for (const [name, path] of entries) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(name)) {
        return invalidAssets(`asset name ${name}`);
      }
      if (typeof path !== "string" || !isSafeAssetPath(path) || paths.has(path)) {
        return invalidAssets(`${name}: ${String(path)}`);
      }
      paths.add(path);
    }
  }
  const assetMetadata = (manifest as unknown as { assetMetadata?: unknown }).assetMetadata;
  if (assetMetadata !== undefined) {
    const assetNames = new Set(Object.keys(manifest.assets ?? {}));
    if (!isRecord(assetMetadata)) {
      return invalidAssets(`assetMetadata: ${String(assetMetadata)}`);
    }
    const entries = Object.entries(assetMetadata);
    if (entries.length > MAX_ASSETS) {
      return invalidAssets(`asset metadata count ${entries.length}`);
    }
    for (const [name, value] of entries) {
      if (!assetNames.has(name) || !isRecord(value)) {
        return invalidAssets(`assetMetadata.${name}`);
      }
      const allowed = new Set([
        "frameWidth",
        "frameHeight",
        "columns",
        "rows",
        "frameCount",
        "margin",
        "spacing",
      ]);
      if (Object.keys(value).some((key) => !allowed.has(key))) {
        return invalidAssets(`assetMetadata.${name} has an unknown field`);
      }
      const positive = (key: string): boolean => {
        const number = value[key];
        return (
          number === undefined ||
          (typeof number === "number" &&
            Number.isInteger(number) &&
            number > 0 &&
            number <= 100_000)
        );
      };
      const nonNegative = (key: string): boolean => {
        const number = value[key];
        return (
          number === undefined ||
          (typeof number === "number" &&
            Number.isInteger(number) &&
            number >= 0 &&
            number <= 100_000)
        );
      };
      if (
        !positive("frameWidth") ||
        !positive("frameHeight") ||
        !positive("columns") ||
        !positive("rows") ||
        !positive("frameCount") ||
        !nonNegative("margin") ||
        !nonNegative("spacing") ||
        value.frameWidth === undefined ||
        value.frameHeight === undefined
      ) {
        return invalidAssets(`assetMetadata.${name} has invalid frame geometry`);
      }
    }
  }
  if (
    (manifest.dependencies !== undefined && !Array.isArray(manifest.dependencies)) ||
    (manifest.conflicts !== undefined && !Array.isArray(manifest.conflicts)) ||
    (manifest.dependencies ?? []).some((dependency) => typeof dependency !== "string") ||
    (manifest.conflicts ?? []).some((conflict) => typeof conflict !== "string")
  ) {
    return {
      reason: "Extension dependencies and conflicts must be string arrays",
      code: "dependencyArrays",
    };
  }
  for (const dependency of manifest.dependencies ?? []) {
    if (dependency === manifest.id) {
      return { reason: "Extension cannot depend on itself", code: "selfDependency" };
    }
  }
  for (const conflict of manifest.conflicts ?? []) {
    if (conflict === manifest.id) {
      return { reason: "Extension cannot conflict with itself", code: "selfConflict" };
    }
  }
  return null;
}

/** Capability prefixes a data-only package may not declare. */
const DATA_ONLY_FORBIDDEN_CAPABILITIES = ["ui", "panel", "sidebar", "shortcuts"];

/**
 * Keep a script's default shortcuts only when the package declared `shortcuts`.
 *
 * Scripts historically registered their seed bindings without that grant; the
 * missing declaration is now ignored with a warning instead of silently
 * registering a global shortcut.
 */
export function grantScriptDefaultShortcuts(
  owner: string,
  scriptId: string,
  defaultShortcuts: readonly Shortcut[] | undefined,
  granted: ReadonlySet<ExtensionCapability>,
): readonly Shortcut[] | undefined {
  if (!defaultShortcuts?.length) {
    return undefined;
  }
  if (!granted.has("shortcuts")) {
    console.warn(
      "[redux.extensions] script defaultShortcuts ignored: shortcuts capability is not declared",
      { extension: owner, script: scriptId, capability: "shortcuts" },
    );
    return undefined;
  }
  return defaultShortcuts;
}

/** Whether the manifest declares at least one data-only recipe. */
export function hasDeclarativeScripts(manifest: TrustedExtensionManifest | undefined): boolean {
  return Array.isArray(manifest?.scripts) && manifest.scripts.length > 0;
}

/** Whether the package ships recipes without an entry module. */
export function isDataOnlyManifest(manifest: TrustedExtensionManifest): boolean {
  return manifest.entry === undefined && hasDeclarativeScripts(manifest);
}

/**
 * Validate a data-only package.
 *
 * Recipes need unique local ids and at least one step, and the package may not
 * declare UI, panel, sidebar, or shortcut capabilities.
 */
export function validateDataOnlyManifest(
  manifest: TrustedExtensionManifest,
): { reason: string; code: ExtensionOperationErrorCode; value?: string } | null {
  if (!hasDeclarativeScripts(manifest)) {
    return {
      reason: "Extension entry must provide an activate function or declarative scripts",
      code: "entryActivateRequired",
    };
  }
  const seen = new Set<string>();
  for (const script of manifest.scripts ?? []) {
    if (
      !script ||
      typeof script !== "object" ||
      typeof script.id !== "string" ||
      !/^[a-z][a-z0-9._-]{0,63}$/.test(script.id) ||
      seen.has(script.id) ||
      !Array.isArray(script.steps) ||
      script.steps.length === 0
    ) {
      return {
        reason: "Declarative scripts need a unique local id and at least one step",
        code: "entryActivateRequired",
      };
    }
    seen.add(script.id);
  }
  const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  const forbidden = capabilities.filter(
    (capability): capability is string =>
      typeof capability === "string" &&
      DATA_ONLY_FORBIDDEN_CAPABILITIES.some(
        (prefix) => capability === prefix || capability.startsWith(`${prefix}.`),
      ),
  );
  if (forbidden.length > 0) {
    return {
      reason: `Data-only Extension capabilities are not allowed: ${forbidden.join(", ")}`,
      code: "dataOnlyCapabilities",
      value: forbidden.join(", "),
    };
  }
  return null;
}

/** Build the synthetic definition that registers every declarative recipe. */
export function dataOnlyDefinition(manifest: TrustedExtensionManifest): TrustedExtensionDefinition {
  if (!hasDeclarativeScripts(manifest)) {
    throw new Error("Data-only Extension must provide declarative scripts");
  }
  return {
    manifest,
    activate(context) {
      for (const script of manifest.scripts ?? []) {
        const dispose = context.scripts.register({
          id: script.id,
          label: context.i18n.text(script.label ?? { key: `script.${script.id}.label` }),
          description: context.i18n.text(
            script.description ?? { key: `script.${script.id}.description` },
          ),
          parameters: script.parameters,
          steps: script.steps,
        });
        context.addCleanup(dispose);
      }
    },
  };
}
