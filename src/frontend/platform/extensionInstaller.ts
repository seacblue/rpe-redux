/* eslint-disable max-lines -- GitHub resolution, package validation, and install phases share one module. */
/**
 * Resolves, validates, installs, and live-loads Extensions from GitHub.
 *
 * Package text is fetched through the host WebView and validated with the same
 * manifest rules as discovery before the native host writes the managed folder.
 */
import { invoke } from "@tauri-apps/api/core";
import { BUILD_APP_VERSION } from "../../core/platform/buildInfo.ts";
import {
  ExtensionInstallFailure,
  asExtensionInstallFailure,
  isSafePackageRelativePath,
  parseGitHubSource,
  parseMarketplaceCatalog,
  type ExtensionInstallPhase,
  type GitHubPackageSource,
  type MarketplaceCatalog,
} from "../../core/extensions/install.ts";
import {
  materializeManifest,
  validateDataOnlyManifest,
  validateManifest,
} from "../../core/extensions/extensionRuntimeSupport.ts";
import type {
  MaterializedExtensionManifest,
  TrustedExtensionManifest,
} from "../../core/extensions/extensionContract.ts";
import { resolveExtensionText, type ExtensionTranslations } from "../../core/extensions/i18n.ts";
import { extensionRuntime } from "../../core/extensions/extensionRuntime.ts";
import { extensionFingerprint } from "./extensionTrust.ts";
import {
  clearPackagedExtensionRemoval,
  getExtensionStartupState,
  refreshPackagedExtensions,
} from "./extensionLoader.ts";

const GITHUB_API = "https://api.github.com";
const RAW_HOST = "https://raw.githubusercontent.com";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_I18N_BYTES = 256 * 1024;
const MAX_ENTRY_BYTES = 2_000_000;
const MAX_MARKETPLACE_BYTES = 1_000_000;

/** Subset of the GitHub repository response the resolver reads. */
interface GitHubRepository {
  default_branch: string;
  private?: boolean;
  archived?: boolean;
}

/** One entry of a GitHub tree listing. */
interface GitHubTreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  size?: number;
}

/** Recursive GitHub tree response for one commit. */
interface GitHubTree {
  sha: string;
  tree: GitHubTreeEntry[];
  truncated?: boolean;
}

interface GitHubCommit {
  sha: string;
}

interface FetchedFile {
  path: string;
  text: string;
}

/** One package resolved from a repository, with the exact bytes to install. */
export interface ResolvedExtensionPackage {
  source: GitHubPackageSource;
  commit: string;
  manifest: MaterializedExtensionManifest;
  manifestText: string;
  i18nPath: string | null;
  i18nText: string | null;
  entryPath: string | null;
  entryText: string | null;
  fingerprint: string;
  files: readonly { path: string; text: string }[];
}

/** Install one resolved package; an updated package keeps its previous enablement. */
export async function installResolvedExtension(
  resolved: ResolvedExtensionPackage,
): Promise<{ enabled: boolean }> {
  ensureDesktop();
  if (getExtensionStartupState().safeMode) {
    throw new ExtensionInstallFailure({
      code: "safeMode",
      phase: "load",
      message: "Extension installation is disabled while Extension safe mode is active.",
      hint: "Restart without the safe-mode flag and resolve the last startup failure first.",
      source: resolved.source.canonicalUrl,
    });
  }
  if (resolved.manifest.id.startsWith("builtin.")) {
    throw new ExtensionInstallFailure({
      code: "shadowed",
      phase: "validate",
      message: `A managed install cannot claim the built-in id ${resolved.manifest.id}.`,
      hint: "Rename the Extension id in its manifest before installing it.",
      source: resolved.source.canonicalUrl,
    });
  }
  const existing = extensionRuntime
    .list()
    .find((entry) => entry.manifest.id === resolved.manifest.id);
  // An update must not override the user's disabled state; a fresh install is
  // enabled after review.
  const wasEnabled = existing?.status === "enabled";
  if (existing && existing.source !== "installed") {
    throw new ExtensionInstallFailure({
      code: "shadowed",
      phase: "validate",
      message: `Extension ${resolved.manifest.id} is already provided by its ${existing.source} copy.`,
      detail: "A shipped, portable, or development copy takes precedence over the managed root.",
      hint: "Remove the other copy or choose an Extension with a different id.",
      source: resolved.source.canonicalUrl,
    });
  }
  if (existing?.status === "enabled") {
    const dependents = extensionRuntime
      .list()
      .filter(
        (entry) =>
          entry.status === "enabled" &&
          (entry.manifest.dependencies ?? []).includes(resolved.manifest.id),
      );
    if (dependents.length > 0) {
      throw new ExtensionInstallFailure({
        code: "removeFailed",
        phase: "validate",
        message: `Extension ${resolved.manifest.id} is required by an enabled Extension.`,
        detail: dependents.map((entry) => entry.manifest.id).join(", "),
        hint: "Disable the dependent Extensions before updating this package.",
        source: resolved.source.canonicalUrl,
      });
    }
  }
  const files = resolved.files.map((file) => ({ path: file.path, contents: file.text }));
  try {
    await invoke<string>("install_extension", {
      id: resolved.manifest.id,
      files,
      source: resolved.source.canonicalUrl,
    });
  } catch (error) {
    throw asExtensionInstallFailure(error, {
      code: "writeFailed",
      phase: "persist",
      message: `Unable to write Extension ${resolved.manifest.id} into the managed package folder.`,
      source: resolved.source.canonicalUrl,
      hint: "Check that the application data folder is writable.",
    });
  }
  clearPackagedExtensionRemoval(resolved.manifest.id);
  await refreshPackagedExtensions([resolved.manifest.id]);
  const snapshot = extensionRuntime
    .list()
    .find((entry) => entry.manifest.id === resolved.manifest.id);
  if (!snapshot) {
    throw new ExtensionInstallFailure({
      code: "loadFailed",
      phase: "load",
      message: `Extension ${resolved.manifest.id} was written but the runtime did not register it.`,
      detail: "The package may be malformed, shadowed by another root, or removed by the watcher.",
      source: resolved.source.canonicalUrl,
    });
  }
  if (snapshot.source !== "installed") {
    throw new ExtensionInstallFailure({
      code: "shadowed",
      phase: "load",
      message: `Extension ${resolved.manifest.id} is shadowed by its ${snapshot.source} copy.`,
      detail: "A shipped, portable, or development copy with the same id takes precedence.",
      hint: "Remove the other copy or choose an Extension with a different id.",
      source: resolved.source.canonicalUrl,
    });
  }
  if (existing !== undefined && !wasEnabled) {
    return { enabled: false };
  }
  const enabled = await extensionRuntime.enableAsync(resolved.manifest.id, true);
  if (!enabled.ok) {
    throw new ExtensionInstallFailure({
      code: "enableFailed",
      phase: "enable",
      message: `Extension ${resolved.manifest.id} was installed but could not be enabled.`,
      detail: `${enabled.code ?? "unknown"}: ${enabled.reason}`,
      hint: "The package stays installed; resolve the reported dependency, conflict, or entry error and enable it from the list.",
      source: resolved.source.canonicalUrl,
    });
  }
  return { enabled: true };
}

/** Delete a managed package and remove its live runtime record and saved state. */
export async function removeInstalledExtension(id: string): Promise<void> {
  ensureDesktop();
  const unloaded = extensionRuntime.uninstall(id);
  if (!unloaded.ok && unloaded.code !== "notLoaded") {
    throw new ExtensionInstallFailure({
      code: "removeFailed",
      phase: "load",
      message: `Extension ${id} is still in use and was not removed.`,
      detail: `${unloaded.code ?? "unknown"}: ${unloaded.reason}`,
      hint: "Disable or remove an Extension that depends on this package first.",
    });
  }
  try {
    await invoke("remove_extension", { id });
  } catch (error) {
    throw asExtensionInstallFailure(error, {
      code: "writeFailed",
      phase: "persist",
      message: `Unable to remove Extension ${id} from the managed package folder.`,
      hint: "Close the application and remove the folder from the user-data extensions directory.",
    });
  }
  await refreshPackagedExtensions();
}

/** Loads and validates a marketplace JSON document from a configured HTTPS URL. */
export async function loadMarketplaceCatalog(url: string): Promise<MarketplaceCatalog> {
  const trimmed = url.trim();
  if (!trimmed || !/^https:\/\/\S+$/iu.test(trimmed)) {
    throw new ExtensionInstallFailure({
      code: "marketplaceInvalid",
      phase: "marketplace",
      message: "Marketplace URL must be an HTTPS URL.",
      hint: "Paste the raw HTTPS URL of a marketplace JSON document.",
      source: trimmed,
    });
  }
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(trimmed, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    throw new ExtensionInstallFailure({
      code: timedOut ? "timeout" : "network",
      phase: "marketplace",
      message: timedOut
        ? "The marketplace did not answer before the load timeout."
        : "The network request for the marketplace failed.",
      detail: trimmed,
      hint: "Check the connection or the catalog URL and try again.",
      source: trimmed,
      cause: errorMessage(error),
    });
  } finally {
    globalThis.clearTimeout(timer);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ExtensionInstallFailure({
      code: "httpError",
      phase: "marketplace",
      message: `Marketplace returned HTTP ${response.status}.`,
      detail: [response.statusText, body.slice(0, 400)].filter(Boolean).join(", "),
      hint: "Check that the URL points at a public JSON document.",
      source: trimmed,
      status: response.status,
    });
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_MARKETPLACE_BYTES) {
    throw new ExtensionInstallFailure({
      code: "catalogTooLarge",
      phase: "marketplace",
      message: `Marketplace catalog exceeds ${MAX_MARKETPLACE_BYTES} bytes.`,
      source: trimmed,
    });
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new ExtensionInstallFailure({
      code: "network",
      phase: "marketplace",
      message: "The marketplace response was interrupted while reading it.",
      detail: trimmed,
      source: trimmed,
      cause: errorMessage(error),
    });
  }
  if (new TextEncoder().encode(text).byteLength > MAX_MARKETPLACE_BYTES) {
    throw new ExtensionInstallFailure({
      code: "catalogTooLarge",
      phase: "marketplace",
      message: `Marketplace catalog exceeds ${MAX_MARKETPLACE_BYTES} bytes.`,
      source: trimmed,
    });
  }
  try {
    return parseMarketplaceCatalog(text);
  } catch (error) {
    throw asExtensionInstallFailure(error, {
      code: "marketplaceInvalid",
      phase: "marketplace",
      message: "The marketplace document is invalid.",
      source: trimmed,
    });
  }
}

/**
 * Resolves one GitHub link into validated package bytes without writing or
 * executing it; the result is what the confirmation dialog displays.
 */
export async function resolveGitHubExtension(
  input: string | GitHubPackageSource,
): Promise<ResolvedExtensionPackage> {
  ensureDesktop();
  if (typeof input !== "string") {
    return resolveSource(input);
  }
  try {
    return await resolveSource(parseGitHubSource(input));
  } catch (error) {
    throw asExtensionInstallFailure(error, {
      code: "unknown",
      phase: "resolve",
      message: "Unable to resolve the Extension repository.",
      source: input,
    });
  }
}

/** Resolves a parsed source into validated package files without writing anything. */
async function resolveSource(source: GitHubPackageSource): Promise<ResolvedExtensionPackage> {
  const repositoryUrl = `${GITHUB_API}/repos/${source.owner}/${source.repo}`;
  const repository = await githubJson<GitHubRepository>(repositoryUrl, "resolve", source);
  if (!repository || typeof repository.default_branch !== "string") {
    throw new ExtensionInstallFailure({
      code: "httpError",
      phase: "resolve",
      message: "GitHub returned an incomplete repository response.",
      detail: repositoryUrl,
      source: source.canonicalUrl,
    });
  }
  if (repository.private) {
    throw new ExtensionInstallFailure({
      code: "httpError",
      phase: "resolve",
      message: `GitHub repository ${source.owner}/${source.repo} is private.`,
      hint: "Install from a public repository, or download the package and add it to the extensions folder manually.",
      source: source.canonicalUrl,
    });
  }
  const ref = source.ref ?? repository.default_branch;
  if (!ref) {
    throw new ExtensionInstallFailure({
      code: "httpError",
      phase: "resolve",
      message: `GitHub did not report a default branch for ${source.owner}/${source.repo}.`,
      hint: "Use a /tree/<ref>/<path> link that names a branch, tag, or commit.",
      source: source.canonicalUrl,
    });
  }
  const commit = await githubJson<GitHubCommit>(
    `${repositoryUrl}/commits/${encodeURIComponent(ref)}`,
    "resolve",
    source,
  );
  if (!commit || typeof commit.sha !== "string" || !commit.sha) {
    throw new ExtensionInstallFailure({
      code: "httpError",
      phase: "resolve",
      message: `GitHub did not resolve ref ${ref} to a commit.`,
      hint: "Check the branch, tag, or commit in the /tree link.",
      source: source.canonicalUrl,
    });
  }
  const tree = await githubJson<GitHubTree>(
    `${repositoryUrl}/git/trees/${encodeURIComponent(commit.sha)}?recursive=1`,
    "resolve",
    source,
  );
  if (!tree || !Array.isArray(tree.tree)) {
    throw new ExtensionInstallFailure({
      code: "httpError",
      phase: "resolve",
      message: "GitHub returned an incomplete file-tree response.",
      source: source.canonicalUrl,
    });
  }
  if (tree.truncated) {
    throw new ExtensionInstallFailure({
      code: "repoTooLarge",
      phase: "resolve",
      message: `GitHub truncated the file tree for ${source.owner}/${source.repo}.`,
      hint: "Use a /tree/<ref>/<path> link that points at the Extension subdirectory of a smaller repository.",
      source: source.canonicalUrl,
    });
  }
  const blobs = new Set(
    tree.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path),
  );
  const manifestPath = chooseManifestPath(source, [...blobs]);
  const packageDirectory = manifestPath.replace(/\/?manifest\.json$/u, "");
  const manifestFile = await downloadFile(
    source,
    commit.sha,
    manifestPath,
    MAX_MANIFEST_BYTES,
    "manifest",
  );
  const manifest = parseManifest(manifestFile, source);
  const i18n = await resolveTranslations(source, commit.sha, packageDirectory, manifest, blobs);
  const materialized = materializeManifest(manifest, i18n.value ?? undefined);
  const manifestError = validateManifest(materialized, BUILD_APP_VERSION);
  if (manifestError) {
    throw new ExtensionInstallFailure({
      code: "manifestInvalid",
      phase: "validate",
      message: `Extension ${String(materialized.id ?? "?")} has an invalid manifest.`,
      detail: `${manifestError.code ?? "manifestInvalid"}: ${manifestError.reason}`,
      hint: "Fix the manifest in the repository and inspect the link again.",
      source: source.canonicalUrl,
    });
  }
  const entry = await resolveEntry(source, commit.sha, packageDirectory, materialized, blobs);
  if (entry.path === null) {
    const dataError = validateDataOnlyManifest(materialized);
    if (dataError) {
      throw new ExtensionInstallFailure({
        code: "manifestInvalid",
        phase: "validate",
        message: `Extension ${materialized.id} has no code entry and no declarative scripts.`,
        detail: `${dataError.code ?? "entryActivateRequired"}: ${dataError.reason}`,
        source: source.canonicalUrl,
      });
    }
  }
  const fingerprint = await extensionFingerprint(
    manifestFile.text,
    i18n.text ?? undefined,
    entry.text ?? undefined,
  );
  const files = [
    { path: "manifest.json", text: manifestFile.text },
    ...(i18n.path === null ? [] : [{ path: i18n.path, text: i18n.text ?? "" }]),
    ...(entry.path === null ? [] : [{ path: entry.path, text: entry.text ?? "" }]),
  ];
  return {
    source,
    commit: commit.sha,
    manifest: materialized as MaterializedExtensionManifest,
    manifestText: manifestFile.text,
    i18nPath: i18n.path,
    i18nText: i18n.text,
    entryPath: entry.path,
    entryText: entry.text,
    fingerprint,
    files,
  };
}

/** Reject non-desktop hosts before any network or filesystem work. */
function ensureDesktop(): void {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new ExtensionInstallFailure({
      code: "desktopOnly",
      phase: "input",
      message: "Extension installation requires the desktop application.",
      hint: "Run the packaged desktop build; the browser preview can discover packages but cannot write them.",
    });
  }
}

/** Picks the package's manifest path from the tree, rejecting ambiguous repositories. */
function chooseManifestPath(source: GitHubPackageSource, paths: readonly string[]): string {
  if (source.path !== null) {
    const candidate = `${source.path}/manifest.json`;
    if (paths.includes(candidate)) {
      return candidate;
    }
    throw new ExtensionInstallFailure({
      code: "manifestMissing",
      phase: "resolve",
      message: `No manifest.json exists under ${source.path} in ${source.owner}/${source.repo}.`,
      detail: `Looked for ${candidate}.`,
      hint: "Open the package folder itself and copy the repository URL shown in the address bar.",
      source: source.canonicalUrl,
    });
  }
  if (paths.includes("manifest.json")) {
    return "manifest.json";
  }
  const candidates = paths
    .filter((path) => path.endsWith("/manifest.json"))
    .filter((path) => !path.split("/").some((segment) => segment === "node_modules"))
    .sort((left, right) => left.length - right.length || left.localeCompare(right));
  if (candidates.length === 1) {
    return candidates[0];
  }
  if (candidates.length === 0) {
    throw new ExtensionInstallFailure({
      code: "manifestMissing",
      phase: "resolve",
      message: `No manifest.json was found in ${source.owner}/${source.repo}.`,
      hint: "The repository must contain an Extension package with manifest.json.",
      source: source.canonicalUrl,
    });
  }
  throw new ExtensionInstallFailure({
    code: "manifestMultiple",
    phase: "resolve",
    message: `Repository ${source.owner}/${source.repo} contains ${candidates.length} Extension packages.`,
    detail: candidates.slice(0, 8).join(", "),
    hint: "Use a /tree/<ref>/<path> link that points at one package.",
    source: source.canonicalUrl,
  });
}

/** Downloads and parses the declared translations file, if the package has one. */
async function resolveTranslations(
  source: GitHubPackageSource,
  commit: string,
  packageDirectory: string,
  manifest: TrustedExtensionManifest,
  blobs: ReadonlySet<string>,
): Promise<{ path: string | null; text: string | null; value: ExtensionTranslations | null }> {
  const declared =
    typeof (manifest as unknown as { i18n?: unknown }).i18n === "string"
      ? (manifest as unknown as { i18n: string }).i18n
      : null;
  if (declared !== null && !isSafePackageRelativePath(declared)) {
    throw new ExtensionInstallFailure({
      code: "manifestInvalid",
      phase: "validate",
      message: `Extension ${manifest.id} declares an unsafe i18n path: ${declared}`,
      source: source.canonicalUrl,
    });
  }
  const path = packagePath(packageDirectory, declared ?? "i18n.json");
  if (!blobs.has(path)) {
    if (declared !== null) {
      throw new ExtensionInstallFailure({
        code: "packageFileMissing",
        phase: "download",
        message: `Extension ${manifest.id} declares a missing i18n file: ${declared}`,
        source: source.canonicalUrl,
      });
    }
    return { path: null, text: null, value: null };
  }
  const file = await downloadFile(source, commit, path, MAX_I18N_BYTES, "i18n");
  let value: unknown;
  try {
    value = JSON.parse(file.text) as unknown;
  } catch (cause) {
    throw new ExtensionInstallFailure({
      code: "packageFileInvalid",
      phase: "validate",
      message: `Extension ${manifest.id} i18n file is not valid JSON.`,
      detail: file.path,
      source: source.canonicalUrl,
      cause: errorMessage(cause),
    });
  }
  return {
    path: packagePath(packageDirectory, declared ?? "i18n.json"),
    text: file.text,
    value: value as ExtensionTranslations,
  };
}

/** Downloads the declared entry file and checks that it is non-empty. */
async function resolveEntry(
  source: GitHubPackageSource,
  commit: string,
  packageDirectory: string,
  manifest: TrustedExtensionManifest,
  blobs: ReadonlySet<string>,
): Promise<{ path: string | null; text: string | null }> {
  if (manifest.entry === undefined) {
    return { path: null, text: null };
  }
  if (typeof manifest.entry !== "string" || !isSafePackageRelativePath(manifest.entry)) {
    throw new ExtensionInstallFailure({
      code: "manifestInvalid",
      phase: "validate",
      message: `Extension ${manifest.id} declares an unsafe entry path.`,
      detail: String(manifest.entry),
      source: source.canonicalUrl,
    });
  }
  const path = packagePath(packageDirectory, manifest.entry);
  if (!blobs.has(path)) {
    throw new ExtensionInstallFailure({
      code: "packageFileMissing",
      phase: "download",
      message: `Extension ${manifest.id} declares a missing entry file: ${manifest.entry}`,
      source: source.canonicalUrl,
    });
  }
  const file = await downloadFile(source, commit, path, MAX_ENTRY_BYTES, "entry");
  if (!file.text.trim()) {
    throw new ExtensionInstallFailure({
      code: "packageFileInvalid",
      phase: "validate",
      message: `Extension ${manifest.id} entry file is empty.`,
      detail: manifest.entry,
      source: source.canonicalUrl,
    });
  }
  return { path: manifest.entry, text: file.text };
}

/** Joins a package directory with a path relative to it. */
function packagePath(directory: string, relative: string): string {
  return directory ? `${directory}/${relative}` : relative;
}

/** Parses downloaded manifest text, rejecting non-object JSON. */
function parseManifest(file: FetchedFile, source: GitHubPackageSource): TrustedExtensionManifest {
  let value: unknown;
  try {
    value = JSON.parse(file.text) as unknown;
  } catch (cause) {
    throw new ExtensionInstallFailure({
      code: "manifestParse",
      phase: "validate",
      message: "Extension manifest is not valid JSON.",
      detail: file.path,
      source: source.canonicalUrl,
      cause: errorMessage(cause),
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExtensionInstallFailure({
      code: "manifestInvalid",
      phase: "validate",
      message: "Extension manifest must be a JSON object.",
      detail: file.path,
      source: source.canonicalUrl,
    });
  }
  return value as TrustedExtensionManifest;
}

/** Downloads one package file from the raw host and enforces its byte limit. */
async function downloadFile(
  source: GitHubPackageSource,
  commit: string,
  path: string,
  limit: number,
  kind: string,
): Promise<FetchedFile> {
  if (!isSafePackageRelativePath(path)) {
    throw new ExtensionInstallFailure({
      code: "manifestInvalid",
      phase: "validate",
      message: `Extension ${kind} path is unsafe: ${path}`,
      source: source.canonicalUrl,
    });
  }
  const encoded = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `${RAW_HOST}/${source.owner}/${source.repo}/${commit}/${encoded}`;
  const response = await request(url, "download", source, "text/plain");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new ExtensionInstallFailure({
      code: "packageFileTooLarge",
      phase: "download",
      message: `Extension ${kind} file exceeds ${limit} bytes.`,
      detail: `${path} declares ${declared} bytes.`,
      source: url,
    });
  }
  const text = await readText(response, url, source);
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > limit) {
    throw new ExtensionInstallFailure({
      code: "packageFileTooLarge",
      phase: "download",
      message: `Extension ${kind} file exceeds ${limit} bytes.`,
      detail: `${path} is ${bytes} bytes.`,
      source: url,
    });
  }
  return { path, text };
}

/** Requests a GitHub API document and parses it as JSON. */
async function githubJson<T>(
  url: string,
  phase: ExtensionInstallPhase,
  source: GitHubPackageSource,
): Promise<T> {
  const response = await request(url, phase, source, "application/vnd.github+json");
  const text = await readText(response, url, source);
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new ExtensionInstallFailure({
      code: "httpError",
      phase,
      message: "GitHub returned a response that is not JSON.",
      detail: url,
      source: source.canonicalUrl,
      cause: errorMessage(cause),
    });
  }
}

/** Fetches one URL with the install timeout and maps failures to install phases. */
async function request(
  url: string,
  phase: ExtensionInstallPhase,
  source: GitHubPackageSource,
  accept: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // Only safelisted headers are sent: the API and raw host both answer a
  // simple request, so no preflight can fail on a header they do not advertise.
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: accept },
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    throw new ExtensionInstallFailure({
      code: timedOut ? "timeout" : "network",
      phase,
      message: timedOut
        ? "GitHub did not answer before the install timeout."
        : "The network request to GitHub failed.",
      detail: url,
      hint: "Check the connection, proxy, or GitHub availability and try again.",
      source: source.canonicalUrl,
      cause: errorMessage(error),
    });
  } finally {
    globalThis.clearTimeout(timer);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const remaining = response.headers.get("x-ratelimit-remaining");
    const rateLimited = response.status === 429 || (response.status === 403 && remaining === "0");
    throw new ExtensionInstallFailure({
      code: rateLimited ? "rateLimited" : "httpError",
      phase,
      message: rateLimited
        ? "GitHub rate limit reached while resolving the Extension."
        : `GitHub returned HTTP ${response.status} for ${url}.`,
      detail: [response.statusText, body.slice(0, 400)].filter(Boolean).join(", "),
      hint: rateLimited
        ? "Wait for the rate-limit window to reset, or install from a downloaded package."
        : response.status === 404
          ? "Check that the repository, ref, and package path exist and are public."
          : undefined,
      source: source.canonicalUrl,
      status: response.status,
    });
  }
  return response;
}

/** Reads a response body, reporting an interrupted stream as a network failure. */
async function readText(
  response: Response,
  url: string,
  source: GitHubPackageSource,
): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    throw new ExtensionInstallFailure({
      code: "network",
      phase: "download",
      message: "The response body was interrupted while reading it.",
      detail: url,
      source: source.canonicalUrl,
      cause: errorMessage(error),
    });
  }
}

/** Returns an error's message, or the string form of a thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The manifest description in the active language, or an empty string. */
export function manifestDescription(manifest: MaterializedExtensionManifest): string {
  const text = resolveExtensionText(manifest.id, manifest.translations, { key: "description" });
  return text === "description" ? "" : text;
}
