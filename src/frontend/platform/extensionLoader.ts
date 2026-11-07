/* eslint-disable max-lines -- discovery, package parsing, and live refresh share one host loader. */
/**
 * Loads Extension modules from the desktop host.
 *
 * Packaged roots and external directories arrive as source text and are handed
 * to the iframe sandbox; this loader never imports package code into the host.
 * It also owns the one-shot safe-mode pass and the startup evidence the failure
 * screen reports.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  extensionRuntime,
  type ExtensionOperationResult,
  type ExtensionSource,
  type SandboxedExtensionLoader,
  type SandboxedExtensionSource,
  type TrustedExtensionManifest,
} from "../../core/extensions/extensionRuntime.ts";
import {
  clearExtensionBootMarker,
  consumeExtensionSafeModeRequest,
  EMPTY_EXTENSION_STARTUP_DIAGNOSTICS,
  hasDisabledExtensionVersion,
  hasPersistedExtensionState,
  readExtensionBootMarker,
  summarizeExtensionStartup,
  writeExtensionBootMarker,
  type ExtensionStartupActivation,
  type ExtensionStartupFailure,
} from "../../core/extensions/extensionRuntimeSupport.ts";
import { preferences } from "../../core/state/preferences.ts";
import {
  DEFAULT_ENABLED_BUILTIN_IDS,
  builtinTrustFingerprint,
  extensionFingerprint,
  matchesBuiltinTrust,
  type BuiltinTrustRecord,
} from "./extensionTrust.ts";
import {
  clearExtensionReview,
  extensionFileHash,
  setExtensionReview,
  type ExtensionReviewFile,
} from "./extensionReview.ts";
import {
  ANY_PACKAGE_CONTENT,
  ExtensionContentIndex,
  clearExtensionRemoved,
  clearStaleExtensionRemoved,
  isExtensionRemoved,
  markExtensionRemoved,
  packageContentIdentity,
} from "./extensionReconciliation.ts";

/** A package discovered in one of the desktop host's Extension roots. */
interface PackagedExtension {
  id: string;
  manifest: TrustedExtensionManifest;
  entry?: string;
  source: string;
  i18n?: unknown;
}

/** The host only reports roots it owns; anything unexpected is external. */
function extensionSource(value: string): ExtensionSource {
  return value === "resource" || value === "source" || value === "portable" || value === "installed"
    ? value
    : "portable";
}

/** A user-selected module whose source is evaluated only on consent. */
export interface DeferredExtensionModule {
  manifest: TrustedExtensionManifest;
  fingerprint: string;
  loadSource: SandboxedExtensionLoader;
}

const bundledJson = import.meta.glob<string>("../../assets/extensions/**/*.json", {
  query: "?raw",
  import: "default",
});
const bundledEntrySources = import.meta.glob<string>("../../assets/extensions/**/*.{js,mjs}", {
  query: "?raw",
  import: "default",
});

const DEFAULT_I18N_FILE = "i18n.json";

/** Content identities recorded by the last successful registration per package. */
const extensionContent = new ExtensionContentIndex();

export type ExtensionSafeModeReason = "query" | "flag" | "request" | "interrupted" | null;

/** Startup verdict for the Extension pass and the evidence behind it. */
export interface ExtensionStartupState {
  readonly safeMode: boolean;
  readonly reason: ExtensionSafeModeReason;
  readonly failures: readonly ExtensionStartupFailure[];
  readonly activations: readonly ExtensionStartupActivation[];
}

let startupState: ExtensionStartupState = Object.freeze({
  safeMode: false,
  reason: null,
  failures: EMPTY_EXTENSION_STARTUP_DIAGNOSTICS.failures,
  activations: EMPTY_EXTENSION_STARTUP_DIAGNOSTICS.activations,
});
let startupComplete = false;
/** True only between the start and end of one `loadPackagedExtensions()` pass. */
let startupPassActive = false;
let startupResults: ExtensionOperationResult[] = [];
let startupCaughtFailures: ExtensionStartupFailure[] = [];

/** Why the startup pass skipped Extension code, for the settings surface. */
export function getExtensionStartupState(): ExtensionStartupState {
  return startupState;
}

/** Record one operation result while the startup pass is collecting evidence. */
function recordStartupResult(result: ExtensionOperationResult): void {
  if (startupPassActive) {
    startupResults.push(result);
  }
}

/** Record a package load error the runtime did not turn into a result. */
function recordStartupFailure(failure: ExtensionStartupFailure): void {
  if (startupPassActive) {
    startupCaughtFailures.push(failure);
  }
}

/** Freeze one caught failure into the same shape as runtime-derived evidence. */
function caughtStartupFailure(
  id: string,
  name: string | undefined,
  version: string | undefined,
  message: string,
): ExtensionStartupFailure {
  return Object.freeze({ id, name: name ?? id, version: version ?? "", message });
}

/** Rebuild the startup evidence from the collected results and runtime snapshots. */
function publishStartupDiagnostics(): void {
  const summarized = summarizeExtensionStartup(startupResults, extensionRuntime.list());
  const failures = [...summarized.failures];
  for (const failure of startupCaughtFailures) {
    if (!failures.some((existing) => existing.id === failure.id)) {
      failures.push(failure);
    }
  }
  startupState = Object.freeze({
    safeMode: startupState.safeMode,
    reason: startupState.reason,
    failures: Object.freeze(failures),
    activations: summarized.activations,
  });
}

/** Clear the evidence before one startup pass begins. */
function resetStartupDiagnostics(): void {
  startupResults = [];
  startupCaughtFailures = [];
  startupState = Object.freeze({
    safeMode: false,
    reason: null,
    failures: EMPTY_EXTENSION_STARTUP_DIAGNOSTICS.failures,
    activations: EMPTY_EXTENSION_STARTUP_DIAGNOSTICS.activations,
  });
}

/** Byte length of a string in UTF-8. */
function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Whether a manifest-declared file is a bounded relative JSON path. */
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

/** Resolves the one declared package file without accepting filesystem syntax. */
export function resolvePackageFile(manifest: TrustedExtensionManifest, field: "i18n"): string {
  const value = (manifest as unknown as Record<string, unknown>)[field];
  const path = value === undefined ? DEFAULT_I18N_FILE : value;
  if (typeof path !== "string" || !isSafePackageFilePath(path)) {
    throw new Error(
      `Extension ${manifest.id} has an invalid ${field} path: ${typeof path === "string" ? path : String(path)}`,
    );
  }
  return path;
}

/** Applies file translations before the runtime considers deprecated inline text. */
export function withPackageTranslations(
  manifest: TrustedExtensionManifest,
  fileTranslations: unknown,
): TrustedExtensionManifest {
  if (fileTranslations === undefined) {
    return manifest;
  }
  if (manifest.translations !== undefined) {
    console.warn(
      `[redux.extensions] ${manifest.id} declares both an i18n file and inline translations; using the file`,
    );
  }
  return {
    ...manifest,
    translations: fileTranslations as TrustedExtensionManifest["translations"],
  };
}

/** Whether the page runs inside the Tauri host. */
function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/** Parses manifest JSON text into the trusted manifest shape. */
function manifestFromText(text: string): TrustedExtensionManifest {
  return JSON.parse(text) as TrustedExtensionManifest;
}

/** Version and fingerprint of one shipped package, used to verify built-ins. */
type BundledTrust = BuiltinTrustRecord;

let bundledTrustPromise: Promise<Map<string, BundledTrust>> | null = null;

/** The shipped packages are the allowlist; their canonical bytes are the key. */
function bundledTrust(): Promise<Map<string, BundledTrust>> {
  bundledTrustPromise ??= (async () => {
    const trust = new Map<string, BundledTrust>();
    for (const [manifestPath, loadManifest] of Object.entries(bundledJson)) {
      if (!manifestPath.endsWith("/manifest.json")) {
        continue;
      }
      try {
        const manifestRaw = await loadManifest();
        const manifest = manifestFromText(manifestRaw);
        const translations = await bundledTranslations(manifest, manifestPath);
        const entryPath =
          manifest.entry === undefined
            ? undefined
            : manifestPath.replace(/manifest\.json$/, manifest.entry);
        const entrySource =
          entryPath === undefined ? undefined : await bundledEntrySources[entryPath]?.();
        if (entryPath !== undefined && entrySource === undefined) {
          continue;
        }
        trust.set(manifest.id, {
          version: manifest.version,
          fingerprint: await builtinTrustFingerprint(manifest, translations?.value, entrySource),
        });
      } catch (error) {
        console.warn("[redux.extensions] unable to fingerprint a bundled package", error);
      }
    }
    return trust;
  })();
  return bundledTrustPromise;
}

/** Parsed and raw translations of a bundled package. */
interface BundledTranslations {
  value: unknown;
  raw: string;
}

/** Loads and parses a bundled package's declared translation file. */
async function bundledTranslations(
  manifest: TrustedExtensionManifest,
  manifestPath: string,
): Promise<BundledTranslations | undefined> {
  const path = resolvePackageFile(manifest, "i18n");
  const packagePath = manifestPath.replace(/manifest\.json$/, "");
  const translationPath = `${packagePath}${path}`;
  const loadRaw = bundledJson[translationPath];
  if (!loadRaw) {
    if ((manifest as unknown as Record<string, unknown>).i18n === undefined) {
      return undefined;
    }
    throw new Error(`Extension ${manifest.id} i18n file is missing: ${path}`);
  }
  const raw = await loadRaw();
  if (utf8ByteLength(raw) > 256 * 1024) {
    throw new Error(`Extension ${manifest.id} i18n file is too large: ${path}`);
  }
  try {
    return { value: JSON.parse(raw) as unknown, raw };
  } catch (error) {
    throw new Error(
      `Extension ${manifest.id} i18n file is invalid JSON: ${path} (${errorMessage(error)})`,
      { cause: error },
    );
  }
}

/** Returns an error's message, or the string form of a thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Records the package files the consent dialog will display. */
async function registerReview(
  manifest: TrustedExtensionManifest,
  source: ExtensionSource,
  sourceLabel: string | null,
  fingerprint: string | null,
  files: readonly { path: string; text: string }[],
): Promise<void> {
  const reviewed: ExtensionReviewFile[] = await Promise.all(
    files.map(async (file) => ({
      path: file.path,
      bytes: utf8ByteLength(file.text),
      hash: await extensionFileHash(file.text),
      text: file.text,
    })),
  );
  setExtensionReview({
    id: manifest.id,
    source,
    sourceLabel,
    fingerprint,
    files: reviewed,
  });
}

/**
 * Enable a verified built-in only on the first launch for that version.
 *
 * A persisted state (including an explicit disable) always wins; this prevents
 * an application update from re-enabling a package the user turned off.
 */
async function enableDefaultBuiltin(manifest: TrustedExtensionManifest): Promise<void> {
  if (
    !DEFAULT_ENABLED_BUILTIN_IDS.has(manifest.id) ||
    hasPersistedExtensionState(manifest, preferences) ||
    hasDisabledExtensionVersion(manifest, preferences)
  ) {
    return;
  }
  const result = await extensionRuntime.enableAsync(manifest.id, true);
  if (!result.ok) {
    recordStartupFailure(
      caughtStartupFailure(manifest.id, manifest.name, manifest.version, result.reason),
    );
    console.error("[redux.extensions] unable to enable a default built-in", result);
  }
}

/**
 * Registers every bundled package and, unless this is a safe-mode metadata
 * pass, enables the default built-ins for this version.
 */
async function loadBundledExtensions(enableDefaults = true): Promise<void> {
  const trust = await bundledTrust();
  for (const [manifestPath, loadManifest] of Object.entries(bundledJson)) {
    if (!manifestPath.endsWith("/manifest.json")) {
      continue;
    }
    let manifest: TrustedExtensionManifest | undefined;
    try {
      const manifestRaw = await loadManifest();
      manifest = manifestFromText(manifestRaw);
      const translations = await bundledTranslations(manifest, manifestPath);
      const translationValue = translations?.value;
      const translationRaw = translations?.raw;
      const identity = packageContentIdentity(manifest, translationValue);
      if (isExtensionRemoved(preferences, manifest.id, identity)) {
        // A browser bundled package removed from the list stays hidden until its
        // manifest bytes change.
        continue;
      }
      clearStaleExtensionRemoved(preferences, manifest.id, identity);
      const entryPath =
        manifest.entry === undefined
          ? undefined
          : manifestPath.replace(/manifest\.json$/, manifest.entry);
      const entrySource =
        entryPath === undefined ? undefined : await bundledEntrySources[entryPath]?.();
      if (entryPath !== undefined && entrySource === undefined) {
        throw new Error(`Extension entry source is missing: ${manifest.id}`);
      }
      const fingerprint = await extensionFingerprint(manifestRaw, translationRaw, entrySource);
      const expected = trust.get(manifest.id);
      const verifiedBuiltin = matchesBuiltinTrust(
        expected,
        manifest.version,
        await builtinTrustFingerprint(manifest, translationValue, entrySource),
      );
      await registerReview(manifest, "bundled", null, fingerprint, [
        { path: "manifest.json", text: manifestRaw },
        ...(translationRaw === undefined
          ? []
          : [{ path: resolvePackageFile(manifest, "i18n"), text: translationRaw }]),
        ...(entryPath === undefined
          ? []
          : [{ path: manifest.entry ?? "", text: entrySource ?? "" }]),
      ]);
      const reviewedManifest = withPackageTranslations(manifest, translationValue);
      const result = extensionRuntime.loadManifest(
        reviewedManifest,
        entrySource === undefined
          ? undefined
          : async () => ({
              source: entrySource,
              translations: translationValue as SandboxedExtensionSource["translations"],
            }),
        { fingerprint, source: "bundled", verifiedBuiltin },
      );
      if (!result.ok) {
        recordStartupFailure(
          caughtStartupFailure(manifest.id, manifest.name, manifest.version, result.reason),
        );
        console.error("[redux.extensions] unable to register bundled metadata", result);
        continue;
      }
      extensionContent.remember(manifest.id, identity);
      if (verifiedBuiltin && enableDefaults) {
        await enableDefaultBuiltin(manifest);
      }
    } catch (error) {
      // One malformed package must not stop the remaining built-ins.
      if (manifest) {
        recordStartupFailure(
          caughtStartupFailure(manifest.id, manifest.name, manifest.version, errorMessage(error)),
        );
      }
      console.error(`[redux.extensions] unable to load bundled package ${manifestPath}`, error);
    }
  }
}

/**
 * Registers packages found in the host's writable roots, reloading changed ones
 * on refresh. `enableDefaults` is false during a safe-mode metadata pass.
 */
async function loadPortableExtensions(
  skipExisting = false,
  forceIds: readonly string[] = [],
  enableDefaults = true,
): Promise<void> {
  const packages = await invoke<PackagedExtension[]>("list_extensions");
  const trust = await bundledTrust();
  for (const packaged of packages) {
    try {
      const identity = packageContentIdentity(packaged.manifest, packaged.i18n);
      const existing = extensionRuntime
        .list()
        .find((entry) => entry.manifest.id === packaged.manifest.id);
      const removed = isExtensionRemoved(preferences, packaged.manifest.id, identity);
      if (existing && removed) {
        // A removal that raced an in-flight poll must still win.
        extensionRuntime.suspendDependents(
          packaged.manifest.id,
          `Dependency ${packaged.manifest.id} was removed`,
        );
        const unloaded = extensionRuntime.unload(packaged.manifest.id);
        if (unloaded.ok) {
          clearExtensionReview(packaged.manifest.id);
          extensionContent.forget(packaged.manifest.id);
        }
        continue;
      }
      const action = extensionContent.reconcile(packaged.manifest.id, identity, {
        existing: existing !== undefined,
        userManaged: existing?.source === "portable" || existing?.source === "installed",
        skipExisting,
        force: forceIds.includes(packaged.manifest.id),
        removed,
      });
      if (action === "skip") {
        continue;
      }
      if (action === "reload") {
        // A dependency replacement must not leave enabled dependents running
        // against an unloaded package. They keep their persisted enabled flag
        // and return through restorePersisted once the dependency is back.
        extensionRuntime.suspendDependents(packaged.manifest.id);
        const unloaded = extensionRuntime.unload(packaged.manifest.id);
        if (!unloaded.ok) {
          console.error("[redux.extensions] unable to reload packaged Extension", unloaded);
          continue;
        }
        clearExtensionReview(packaged.manifest.id);
        extensionContent.forget(packaged.manifest.id);
      } else {
        // Registration clears a marker left by older bytes; a marker for these
        // bytes was handled above and the package stays hidden.
        clearStaleExtensionRemoved(preferences, packaged.manifest.id, identity);
      }
      const manifestRaw = JSON.stringify(packaged.manifest);
      const translationRaw =
        packaged.i18n === undefined ? undefined : JSON.stringify(packaged.i18n);
      const source = extensionSource(packaged.source);
      const manifest = withPackageTranslations(packaged.manifest, packaged.i18n);
      const entryBytes =
        packaged.entry === undefined
          ? undefined
          : await invoke<number[]>("read_extension_entry", { id: packaged.id });
      const entryText =
        entryBytes === undefined ? undefined : new TextDecoder().decode(new Uint8Array(entryBytes));
      const expected = trust.get(manifest.id);
      const verifiedBuiltin =
        (source === "bundled" || source === "resource" || source === "source") &&
        matchesBuiltinTrust(
          expected,
          manifest.version,
          await builtinTrustFingerprint(packaged.manifest, packaged.i18n, entryText),
        );
      if (manifest.id.startsWith("builtin.") && !verifiedBuiltin) {
        // A writable source/portable root must never impersonate a built-in id.
        console.warn(
          `[redux.extensions] ignored unverified package claiming a built-in id: ${manifest.id}`,
        );
        continue;
      }
      if (isExtensionRemoved(preferences, manifest.id, identity)) {
        // The user removed this package while its entry was being read.
        continue;
      }
      const fingerprint = await extensionFingerprint(manifestRaw, translationRaw, entryBytes);
      await registerReview(manifest, source, packaged.id, fingerprint, [
        { path: "manifest.json", text: manifestRaw },
        ...(translationRaw === undefined
          ? []
          : [{ path: resolvePackageFile(manifest, "i18n"), text: translationRaw }]),
        ...(packaged.entry === undefined ? [] : [{ path: packaged.entry, text: entryText ?? "" }]),
      ]);
      const result = extensionRuntime.loadManifest(
        manifest,
        entryText === undefined
          ? undefined
          : // Hand the consented bytes to the sandbox; the entry is not re-read at
            // activation. Even a verified built-in stays deferred until enable.
            async () => ({
              source: entryText,
              translations: packaged.i18n as SandboxedExtensionSource["translations"],
            }),
        { fingerprint, source, verifiedBuiltin },
      );
      if (!result.ok) {
        recordStartupFailure(
          caughtStartupFailure(manifest.id, manifest.name, manifest.version, result.reason),
        );
        console.error("[redux.extensions] unable to register packaged metadata", result);
        continue;
      }
      extensionContent.remember(manifest.id, identity);
      if (verifiedBuiltin && enableDefaults) {
        await enableDefaultBuiltin(manifest);
      }
    } catch (error) {
      // A malformed or unreadable package is isolated to its own row.
      const manifest = packaged.manifest as TrustedExtensionManifest | null | undefined;
      recordStartupFailure(
        caughtStartupFailure(
          typeof manifest?.id === "string" ? manifest.id : packaged.id,
          typeof manifest?.name === "string" ? manifest.name : undefined,
          typeof manifest?.version === "string" ? manifest.version : undefined,
          errorMessage(error),
        ),
      );
      console.error(`[redux.extensions] unable to load packaged Extension ${packaged.id}`, error);
    }
  }
}

/** Advances past whitespace and JavaScript comments. */
function skipTrivia(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index + 2);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) {
        throw new Error("Extension metadata contains an unterminated comment");
      }
      index = end + 2;
      continue;
    }
    break;
  }
  return index;
}

/** Reads one quoted string literal and its escape sequences. */
function parseString(source: string, start: number): { value: string; next: number } {
  const quote = source[start];
  let value = "";
  let index = start + 1;
  while (index < source.length) {
    const character = source[index++];
    if (character === quote) {
      return { value, next: index };
    }
    if (character !== "\\") {
      value += character;
      continue;
    }
    if (index >= source.length) {
      break;
    }
    const escaped = source[index++];
    const escapes: Record<string, string> = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      "0": "\0",
    };
    if (escaped === "x" || escaped === "u") {
      const length = escaped === "x" ? 2 : 4;
      const digits = source.slice(index, index + length);
      if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(digits)) {
        throw new Error("Extension metadata contains an invalid string escape");
      }
      value += String.fromCodePoint(parseInt(digits, 16));
      index += length;
    } else {
      value += escapes[escaped] ?? escaped;
    }
  }
  throw new Error("Extension metadata contains an unterminated string");
}

/** Reads a static JSON-like literal without evaluating package code. */
function parseStaticValue(source: string, start: number): { value: unknown; next: number } {
  const index = skipTrivia(source, start);
  const character = source[index];
  if (character === '"' || character === "'") {
    return parseString(source, index);
  }
  if (character === "{") {
    const value: Record<string, unknown> = {};
    let next = skipTrivia(source, index + 1);
    if (source[next] === "}") {
      return { value, next: next + 1 };
    }
    while (next < source.length) {
      next = skipTrivia(source, next);
      let key: string;
      if (source[next] === '"' || source[next] === "'") {
        const parsed = parseString(source, next);
        key = parsed.value;
        next = parsed.next;
      } else {
        const match = /^[A-Za-z_$][\w$]*/.exec(source.slice(next));
        if (!match) {
          throw new Error("Extension metadata has a non-static object key");
        }
        key = match[0];
        next += key.length;
      }
      next = skipTrivia(source, next);
      if (source[next] !== ":") {
        throw new Error("Extension metadata object is missing a colon");
      }
      const parsed = parseStaticValue(source, next + 1);
      value[key] = parsed.value;
      next = skipTrivia(source, parsed.next);
      if (source[next] === "}") {
        return { value, next: next + 1 };
      }
      if (source[next] !== ",") {
        throw new Error("Extension metadata object is missing a comma");
      }
      next = skipTrivia(source, next + 1);
      if (source[next] === "}") {
        return { value, next: next + 1 };
      }
    }
    throw new Error("Extension metadata object is unterminated");
  }
  if (character === "[") {
    const value: unknown[] = [];
    let next = skipTrivia(source, index + 1);
    if (source[next] === "]") {
      return { value, next: next + 1 };
    }
    while (next < source.length) {
      const parsed = parseStaticValue(source, next);
      value.push(parsed.value);
      next = skipTrivia(source, parsed.next);
      if (source[next] === "]") {
        return { value, next: next + 1 };
      }
      if (source[next] !== ",") {
        throw new Error("Extension metadata array is missing a comma");
      }
      next = skipTrivia(source, next + 1);
      if (source[next] === "]") {
        return { value, next: next + 1 };
      }
    }
    throw new Error("Extension metadata array is unterminated");
  }
  const token = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(index));
  if (token) {
    return { value: Number(token[0]), next: index + token[0].length };
  }
  for (const [literal, value] of [
    ["true", true],
    ["false", false],
    ["null", null],
  ] as const) {
    if (source.startsWith(literal, index)) {
      return { value, next: index + literal.length };
    }
  }
  throw new Error("Extension metadata must be a static literal");
}

/** Finds the entry's static `manifest` object without importing the module. */
function readStaticManifest(source: string): TrustedExtensionManifest {
  let index = 0;
  while (index < source.length) {
    index = skipTrivia(source, index);
    if (index >= source.length) {
      break;
    }
    if (source[index] === '"' || source[index] === "'" || source[index] === "`") {
      index = parseString(source, index).next;
      continue;
    }
    const match = /^[A-Za-z_$][\w$]*/.exec(source.slice(index));
    if (!match) {
      index += 1;
      continue;
    }
    index += match[0].length;
    const afterName = skipTrivia(source, index);
    if (match[0] !== "manifest" || source[afterName] !== ":") {
      continue;
    }
    const parsed = parseStaticValue(source, afterName + 1);
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      throw new Error("Extension manifest must be a static object");
    }
    return parsed.value as TrustedExtensionManifest;
  }
  throw new Error("Extension entry must expose a static manifest object");
}

/** Read a user module's manifest without importing or evaluating its code. */
export async function readUserExtension(file: File): Promise<DeferredExtensionModule> {
  const sourceText = await file.text();
  const manifest = readStaticManifest(sourceText);
  const fingerprint = await extensionFingerprint(JSON.stringify(manifest), undefined, sourceText);
  return {
    manifest,
    fingerprint,
    loadSource: async () => ({ source: sourceText }),
  };
}

/**
 * Loads metadata first, then restores only entries already confirmed and enabled.
 *
 * A boot marker wraps the evaluation pass: if an entry hangs or the process is
 * killed, the next launch skips all Extension code and leaves the editor usable.
 * The desktop host can also set the flag through `--extensions-off` or its native
 * watchdog. A one-shot request from the startup failure screen is consumed here
 * and keeps the pass metadata-only.
 */
export async function loadPackagedExtensions(): Promise<void> {
  const previousSafeMode = startupState.safeMode;
  const previousSafeReason = startupState.reason;
  startupPassActive = true;
  resetStartupDiagnostics();
  try {
    const parameters = new URL(location.href).searchParams;
    // `mods=off` is the legacy spelling of the `extensions=off` safe-mode switch.
    const querySafe = parameters.get("extensions") === "off" || parameters.get("mods") === "off";
    let flagSafe = false;
    if (isTauri()) {
      try {
        flagSafe = await invoke<boolean>("extension_safe_mode");
      } catch {
        flagSafe = false;
      }
    }
    const requested = consumeExtensionSafeModeRequest(preferences) !== null;
    const interrupted = readExtensionBootMarker(preferences) !== null;
    // First match wins: URL, host flag, one-shot request, then the unfinished
    // pass. A retry inside a safe-mode launch stays safe even after the request
    // has been consumed; a page reload starts a new pass with the request gone.
    const reason: ExtensionSafeModeReason = querySafe
      ? "query"
      : flagSafe
        ? "flag"
        : requested
          ? "request"
          : interrupted
            ? "interrupted"
            : previousSafeMode
              ? previousSafeReason
              : null;
    if (reason) {
      startupState = Object.freeze({
        safeMode: true,
        reason,
        failures: EMPTY_EXTENSION_STARTUP_DIAGNOSTICS.failures,
        activations: EMPTY_EXTENSION_STARTUP_DIAGNOSTICS.activations,
      });
      clearExtensionBootMarker(preferences);
      document.documentElement.dataset.extensionSafeMode = reason;
      try {
        // Metadata only: Settings → Extensions must still list packages so the
        // user can disable the one that broke the previous launch. No entry is
        // evaluated and no default built-in is enabled.
        if (isTauri()) {
          await loadPortableExtensions(false, [], false);
        } else {
          await loadBundledExtensions(false);
        }
      } catch (error) {
        console.error("Unable to register Extension metadata in safe mode", error);
      }
      console.warn(
        "[redux.extensions] safe mode: Extension metadata only; no Extension code was evaluated",
      );
      return;
    }

    startupState = Object.freeze({
      safeMode: false,
      reason: null,
      failures: EMPTY_EXTENSION_STARTUP_DIAGNOSTICS.failures,
      activations: EMPTY_EXTENSION_STARTUP_DIAGNOSTICS.activations,
    });
    writeExtensionBootMarker("startup", preferences);
    try {
      if (isTauri()) {
        await loadPortableExtensions();
      } else {
        await loadBundledExtensions();
      }
      for (const result of await extensionRuntime.restorePersisted()) {
        recordStartupResult(result);
      }
    } catch (error) {
      console.error("Unable to load packaged Extensions", error);
    }
  } finally {
    publishStartupDiagnostics();
    startupPassActive = false;
    startupComplete = true;
    clearExtensionBootMarker(preferences);
  }
}

let refreshPromise: Promise<void> | null = null;

/**
 * Re-scans the host Extension roots without a page reload.
 *
 * New folders are registered disabled, a missing package is unloaded (its
 * persisted state is kept), and changed manifest/i18n bytes drop the old record
 * so consent is re-evaluated. An explicit removal marker keeps the same bytes
 * hidden until the manifest changes or the package is installed again. The poll
 * is best-effort: a malformed package logs and leaves the current set alone.
 */
export function refreshPackagedExtensions(forceIds: readonly string[] = []): Promise<void> {
  if (!isTauri() || startupState.safeMode || startupPassActive || !startupComplete) {
    return Promise.resolve();
  }
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = (async () => {
    const packages = await invoke<PackagedExtension[]>("list_extensions");
    const present = new Set(packages.map((entry) => entry.id));
    for (const snapshot of extensionRuntime.list()) {
      const userManaged = snapshot.source === "portable" || snapshot.source === "installed";
      if (userManaged && !present.has(snapshot.manifest.id)) {
        // A missing package must not leave dependents silently enabled.
        extensionRuntime.suspendDependents(
          snapshot.manifest.id,
          `Dependency ${snapshot.manifest.id} is missing from disk`,
        );
        const unloaded = extensionRuntime.unload(snapshot.manifest.id);
        if (unloaded.ok) {
          clearExtensionReview(snapshot.manifest.id);
          extensionContent.forget(snapshot.manifest.id);
        }
      }
    }
    await loadPortableExtensions(true, forceIds);
    await extensionRuntime.restorePersisted();
  })()
    .catch((error) => {
      console.error("Unable to refresh packaged Extensions", error);
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

/**
 * Re-read one package from disk even when its manifest is unchanged.
 *
 * The automatic poll compares manifest and i18n bytes only. This entry point is
 * the explicit refresh for a package whose entry file changed in place.
 */
export function reloadPackagedExtension(extensionId: string): Promise<void> {
  return refreshPackagedExtensions([extensionId]);
}

/**
 * Remove one folder-backed package and remember the removal.
 *
 * The package files stay on disk, so discovery would otherwise register the
 * same folder again on the next poll. The marker is bound to the manifest and
 * i18n identity; changing either file makes the package visible again.
 */
export function removePackagedExtension(extensionId: string): ExtensionOperationResult {
  const snapshot = extensionRuntime.list().find((entry) => entry.manifest.id === extensionId);
  const identity = extensionContent.identityOf(extensionId);
  const shipped =
    snapshot?.source === "bundled" ||
    snapshot?.source === "source" ||
    snapshot?.source === "resource";
  // A shipped built-in keeps its persisted disable flag so a later application
  // update cannot re-enable it; a user-dropped portable package is purged.
  const result = shipped
    ? extensionRuntime.unload(extensionId)
    : extensionRuntime.uninstall(extensionId);
  if (!result.ok) {
    return result;
  }
  if (
    snapshot?.source === "bundled" ||
    snapshot?.source === "source" ||
    snapshot?.source === "resource" ||
    snapshot?.source === "portable"
  ) {
    markExtensionRemoved(preferences, extensionId, identity ?? ANY_PACKAGE_CONTENT);
  }
  extensionContent.forget(extensionId);
  clearExtensionReview(extensionId);
  return result;
}

/** Drop a removal marker when a package is installed again. */
export function clearPackagedExtensionRemoval(extensionId: string): void {
  clearExtensionRemoved(preferences, extensionId);
}
