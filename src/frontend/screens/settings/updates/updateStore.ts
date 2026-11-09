/**
 * Update-check state, changelog data, and the signed update flow.
 *
 * The GitHub release list drives the changelog and the "is there a newer version"
 * decision. The host prefers the signed portable ZIP on Windows, verifies it with
 * the configured public key, snapshots durable data, and hands off to the
 * post-exit helper; other platforms and older releases fall back to the Tauri
 * installer path.
 */
import { getDocumentApi } from "../../../../core/edit/document/api.ts";
import { acquireLongTaskFence, getLongTasks } from "../../../../core/state/longTasks.ts";
import {
  startDownloadTask,
  type DownloadTaskOutcome,
} from "../../../../core/state/downloadTask.ts";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appVersion } from "../../../../core/platform/appInfo.ts";
import { BUILD_APP_VERSION } from "../../../../core/platform/buildInfo.ts";
import { isDesktop } from "../../../../core/platform/environment.ts";
import {
  GithubReleaseError,
  fetchGithubReleases,
  type GithubRelease,
  type GithubReleaseErrorCode,
} from "../../../../core/platform/desktop/githubReleases.ts";
import { localService } from "../../../../core/global/library/service.ts";
import { preferences } from "../../../../core/state/preferences.ts";
import { declarePersistedValue } from "../../../../core/settings/settings.ts";
import {
  DEFAULT_UPDATE_AUTO_CHECK,
  DEFAULT_UPDATE_DOWNLOAD_POLICY,
  UPDATE_SETTING_KEYS,
  type UpdateDownloadPolicy,
} from "../../../../core/settings/updateKeys.ts";
import { networkStatus } from "../../../../core/platform/desktop/network.ts";
import { allowsAutomaticDownload } from "../../../../core/platform/desktop/updatePolicy.ts";
import {
  UPDATE_PUBLIC_KEY,
  UPDATE_REPOSITORY,
} from "../../../../core/platform/desktop/updateConfig.ts";
import { values } from "../../../../core/state/values.ts";
import { compareVersions, isVersion } from "../../../../core/utils/version.ts";
import { t } from "../../../../i18n/index.ts";
import { openSettings } from "../settingsWindowController.ts";
import { requestChangelog } from "./changelogLauncher.ts";
import { requestUpdatePrompt } from "./updatePromptLauncher.ts";

export { UPDATE_SETTING_KEYS };

declarePersistedValue(UPDATE_SETTING_KEYS.autoCheck, DEFAULT_UPDATE_AUTO_CHECK);
declarePersistedValue(UPDATE_SETTING_KEYS.prereleases, false);
declarePersistedValue(UPDATE_SETTING_KEYS.downloadPolicy, DEFAULT_UPDATE_DOWNLOAD_POLICY);
declarePersistedValue(UPDATE_SETTING_KEYS.skippedVersion, "");

/** Every phase the update flow can publish. */
export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloaded"
  | "scheduled"
  | "up-to-date"
  | "unconfigured"
  | "preparing"
  | "verifying"
  | "downloading"
  | "installing"
  | "installed"
  | "error";

/** Stable failure codes the update surfaces translate. */
export type UpdateErrorCode =
  | GithubReleaseErrorCode
  | "public-key"
  | "portable"
  | "save-first"
  | "tasks-active"
  | "resource-conflict"
  | "local-invalid"
  | "local-handoff"
  | "install";

/** The first reason the current configuration cannot install, independent of layout. */
type InstallBlock = "portable" | "public-key";

/** Whether a phase owns the update controls. */
export function isUpdateBusy(phase: UpdatePhase): boolean {
  return (
    phase === "preparing" ||
    phase === "verifying" ||
    phase === "downloading" ||
    phase === "installing"
  );
}

/** The configuration reason installation is unavailable, or null when it can proceed. */
export function installBlockReason(
  state: Pick<UpdateState, "portable" | "publicKey">,
): InstallBlock | null {
  if (state.portable) {
    return "portable";
  }
  if (!state.publicKey) {
    return "public-key";
  }
  return null;
}

/** The update applied by a previous launch, with its data backup path. */
export interface UpdateApplied {
  from_version: string;
  to_version: string;
  backup: string;
}

/** A verified package kept from a previous launch instead of being fetched again. */
export interface CachedUpdateInfo {
  version: string;
  tag: string;
  prerelease: boolean;
  kind: "installer" | "portable";
}

/** Build the release-shaped prompt target for one cached package. */
export function releaseFromCachedUpdate(info: CachedUpdateInfo, repo: string): GithubRelease {
  const tag = info.tag.trim() || `v${info.version}`;
  return {
    tag,
    version: info.version,
    name: info.version,
    notes: "",
    publishedAt: "",
    prerelease: info.prerelease,
    url: repo ? `https://github.com/${repo}/releases/tag/${tag}` : "",
  };
}

/** Progress payload emitted by the host during an install handoff. */
interface UpdateProgress {
  phase: "downloading" | "installing" | "installed";
  downloaded: number;
  total: number | null;
}

/** The complete observable update state. */
export interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  releases: GithubRelease[];
  latest: GithubRelease | null;
  available: boolean;
  errorCode: UpdateErrorCode | null;
  errorDetail: string;
  downloaded: number;
  total: number | null;
  updated: UpdateApplied | null;
  portable: boolean;
  repo: string;
  publicKey: string;
  autoCheck: boolean;
  includePrereleases: boolean;
  downloadPolicy: UpdateDownloadPolicy;
  skippedVersion: string;
  preparedVersion: string | null;
}

/** Subscribers notified after each snapshot replacement. */
const listeners = new Set<() => void>();

/** The current snapshot; replace it through `set` so listeners run. */
let state: UpdateState = {
  phase: "idle",
  currentVersion: BUILD_APP_VERSION,
  releases: [],
  latest: null,
  available: false,
  errorCode: null,
  errorDetail: "",
  downloaded: 0,
  total: null,
  updated: null,
  portable: false,
  repo: UPDATE_REPOSITORY,
  publicKey: UPDATE_PUBLIC_KEY,
  autoCheck: DEFAULT_UPDATE_AUTO_CHECK,
  includePrereleases: false,
  downloadPolicy: DEFAULT_UPDATE_DOWNLOAD_POLICY,
  skippedVersion: "",
  preparedVersion: null,
};

/** Shared initialization promise so concurrent callers join one load. */
let initialization: Promise<void> | null = null;
/** Whether the host progress listener is attached. */
let progressListening = false;
/** Receives native byte progress while the current download task is active. */
let activeDownloadReporter: ((downloaded: number, total: number | null) => void) | null = null;
/** Prevent concurrent restart-choice prompts for one prepared package. */
let preparedPromptInFlight: Promise<void> | null = null;

/** Format native byte counts for the long-task detail line. */
function formatMegabytes(value: number): string {
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** The current update snapshot. */
export function getUpdateState(): UpdateState {
  return state;
}

/** Subscribe to state changes; returns the disposer. */
export function subscribeUpdates(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Replace the snapshot and notify every subscriber. */
function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Read a boolean setting or its fallback when unset. */
const settingFlag = (key: string, fallback: boolean): boolean =>
  values.byId.get<boolean | undefined>(key) ?? fallback;

/** Read the persisted package-download policy, rejecting stale values safely. */
function settingDownloadPolicy(): UpdateDownloadPolicy {
  const value = values.byId.get<string | undefined>(UPDATE_SETTING_KEYS.downloadPolicy);
  return value === "all" || value === "wifi" || value === "never"
    ? value
    : DEFAULT_UPDATE_DOWNLOAD_POLICY;
}

/** Read the persisted version the user chose to skip, or an empty string. */
function settingSkippedVersion(): string {
  const value = values.byId.get<string | undefined>(UPDATE_SETTING_KEYS.skippedVersion);
  return value && isVersion(value) ? value : "";
}

/** Re-read the cached update configuration from the value store. */
function refreshSettings(): void {
  set({
    repo: UPDATE_REPOSITORY.trim(),
    publicKey: UPDATE_PUBLIC_KEY.trim(),
    autoCheck: settingFlag(UPDATE_SETTING_KEYS.autoCheck, DEFAULT_UPDATE_AUTO_CHECK),
    includePrereleases: settingFlag(UPDATE_SETTING_KEYS.prereleases, false),
    downloadPolicy: settingDownloadPolicy(),
    skippedVersion: settingSkippedVersion(),
  });
}

/** Refresh the cached settings after the Help page edits a field. */
export function refreshUpdateSettings(): void {
  refreshSettings();
}

/** Subscribe once to the host's update progress events. */
async function ensureProgressListener(): Promise<void> {
  if (!isDesktop() || progressListening) {
    return;
  }
  progressListening = true;
  await listen<UpdateProgress>("redux-update-progress", (event) => {
    const progress = event.payload;
    if (progress.phase === "downloading") {
      set({
        phase: "downloading",
        downloaded: progress.downloaded,
        total: progress.total,
      });
      activeDownloadReporter?.(progress.downloaded, progress.total);
    } else if (progress.phase === "installing") {
      set({ phase: "installing" });
    } else if (progress.phase === "installed") {
      set({ phase: "installed" });
    }
  });
}

/**
 * Load the persisted update configuration and the host's install state.
 *
 * Automatic checks follow the `autoCheck` preference. The manual verify row
 * always checks; initialization only contacts GitHub when the setting is on.
 */
export function initializeUpdates(): Promise<void> {
  if (initialization) {
    return initialization;
  }
  initialization = (async () => {
    refreshSettings();
    const refreshAndMaybeCheck = () => {
      const before = state;
      refreshSettings();
      const becameAutomatic = state.autoCheck && !before.autoCheck;
      if (becameAutomatic && state.repo) {
        void checkForUpdates();
      } else if (
        state.downloadPolicy !== before.downloadPolicy &&
        state.available &&
        state.latest &&
        state.downloadPolicy !== "never"
      ) {
        void autoDownload(state.latest);
      }
    };
    values.byId.subscribe(UPDATE_SETTING_KEYS.autoCheck, refreshAndMaybeCheck);
    values.byId.subscribe(UPDATE_SETTING_KEYS.prereleases, refreshAndMaybeCheck);
    values.byId.subscribe(UPDATE_SETTING_KEYS.downloadPolicy, refreshAndMaybeCheck);
    values.byId.subscribe(UPDATE_SETTING_KEYS.skippedVersion, refreshAndMaybeCheck);
    const version = await appVersion().catch(() => BUILD_APP_VERSION);
    set({ currentVersion: version });
    if (isDesktop()) {
      const [portable, applied, failure, cached] = await Promise.all([
        invoke<string>("install_kind").catch(() => "installed"),
        invoke<UpdateApplied | null>("update_result").catch(() => null),
        invoke<{ detail: string } | null>("local_update_failure").catch(() => null),
        invoke<CachedUpdateInfo | null>("update_restore_cached").catch(() => null),
      ]);
      set({
        portable: portable === "portable",
        updated: applied,
      });
      await ensureProgressListener().catch(() => undefined);
      if (failure) {
        const marker = "update_resource_conflict:";
        const position = failure.detail.indexOf(marker);
        set({
          phase: "error",
          errorCode: position >= 0 ? "resource-conflict" : "local-handoff",
          errorDetail:
            position >= 0 ? failure.detail.slice(position + marker.length) : failure.detail,
        });
        window.setTimeout(() => openSettings("help"), 900);
        return;
      }
      if (cached && isVersion(cached.version) && compareVersions(cached.version, version) > 0) {
        if (cached.version === state.skippedVersion) {
          void invoke("update_cached_remove", { version: cached.version }).catch(() => undefined);
        } else {
          const release = releaseFromCachedUpdate(cached, state.repo);
          set({
            latest: release,
            available: true,
            preparedVersion: release.version,
            phase: "downloaded",
          });
        }
      } else if (cached) {
        void invoke("update_cached_remove", { version: cached.version }).catch(() => undefined);
      }
    }
    if (state.updated) {
      // Defer the changelog request so the shell can mount its modal host first.
      // Opening the surface refreshes the external notes it shows.
      window.setTimeout(requestChangelog, 900);
    }
    if (state.preparedVersion && state.latest) {
      // The verified package survived the last launch; ask without downloading it again.
      void promptForPreparedUpdate(state.latest);
    }
    if (state.autoCheck && state.repo) {
      void checkForUpdates();
    }
  })();
  return initialization;
}

/** Pick the newest release the selected channel is allowed to install. */
export function latestEligibleRelease(
  releases: readonly GithubRelease[],
  includePrereleases: boolean,
  currentVersion: string,
): { release: GithubRelease | null; available: boolean } {
  const eligible = releases.filter(
    (release) => (includePrereleases || !release.prerelease) && isVersion(release.version),
  );
  const latest = eligible.reduce<GithubRelease | null>(
    (best, release) =>
      !best || compareVersions(release.version, best.version) > 0 ? release : best,
    null,
  );
  return {
    release: latest,
    available: Boolean(latest && compareVersions(latest.version, currentVersion) > 0),
  };
}

/** Fetch releases and compare the newest eligible tag with the running version. */
export async function checkForUpdates(): Promise<void> {
  refreshSettings();
  if (!state.repo) {
    set({
      phase: "unconfigured",
      errorCode: null,
      errorDetail: "",
    });
    return;
  }
  set({
    phase: "checking",
    errorCode: null,
    errorDetail: "",
  });
  try {
    const releases = await fetchGithubReleases(state.repo);
    const { release: latest, available } = latestEligibleRelease(
      releases,
      state.includePrereleases,
      state.currentVersion,
    );
    const skipped = latest?.version === state.skippedVersion;
    // Keep a cached package when the eligible release is no newer than it; a
    // channel switch must not strand an already verified download.
    const preparedVersion =
      state.preparedVersion &&
      state.preparedVersion !== state.skippedVersion &&
      (!latest || compareVersions(state.preparedVersion, latest.version) >= 0)
        ? state.preparedVersion
        : null;
    const cachedLatest =
      preparedVersion && state.latest?.version === preparedVersion ? state.latest : null;
    const shownLatest =
      cachedLatest && (!latest || compareVersions(cachedLatest.version, latest.version) > 0)
        ? cachedLatest
        : latest;
    // A check started at launch can settle while the cached prompt already
    // handed off; keep the active installation phase instead of replacing it.
    const installing =
      isUpdateBusy(state.phase) || state.phase === "scheduled" || state.phase === "installed";
    const nextPhase = preparedVersion
      ? "downloaded"
      : available && !skipped
        ? "available"
        : "up-to-date";
    set({
      phase: installing ? state.phase : nextPhase,
      releases,
      latest: shownLatest,
      available: Boolean(preparedVersion) || (available && !skipped),
      preparedVersion,
    });
    if (state.autoCheck && available && latest) {
      void autoDownload(latest);
    }
  } catch (error) {
    // A package handoff or scheduled install owns the surface; a background
    // check failure must not replace its progress with a network error.
    if (isUpdateBusy(state.phase) || state.phase === "scheduled") {
      return;
    }
    const code = error instanceof GithubReleaseError ? error.code : "network";
    set({
      phase: "error",
      errorCode: code,
      errorDetail: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Persist a release choice that suppresses its update badge until a newer version appears. */
export function skipUpdateVersion(version: string): void {
  if (!isVersion(version)) {
    return;
  }
  values.byId.set(UPDATE_SETTING_KEYS.skippedVersion, version);
  if (isDesktop()) {
    // The cached package belongs to the skipped release; keep it from prompting
    // again or occupying space until a newer release replaces it.
    void invoke("update_cached_remove", { version }).catch(() => undefined);
  }
  set({
    skippedVersion: version,
    available: false,
    preparedVersion: null,
    phase: "up-to-date",
    errorCode: null,
    errorDetail: "",
  });
}

/** Recheck the live document and active operations before any installation handoff. */
export function updateSafetyBlock(): "save-first" | "tasks-active" | null {
  const document = getDocumentApi();
  if (!document || document.state().dirty) {
    return "save-first";
  }
  if (getLongTasks().some((task) => task.status === "running" || task.status === "cancelling")) {
    return "tasks-active";
  }
  return null;
}

/** Download a selected release, then share the guarded installation handoff. */
export async function installUpdate(): Promise<void> {
  if (isUpdateBusy(state.phase) || state.phase === "scheduled") {
    return;
  }
  refreshSettings();
  const release = state.latest;
  if (!release || !state.available) {
    return;
  }
  const blocked = installBlockReason(state);
  if (blocked) {
    set({ phase: "error", errorCode: blocked, errorDetail: "" });
    return;
  }
  if (state.preparedVersion === release.version) {
    await promptForPreparedUpdate(release);
    return;
  }
  await downloadUpdate(release);
  if (state.preparedVersion !== release.version) {
    return;
  }
  await promptForPreparedUpdate(release);
}

/** A single in-flight package download shared by automatic and manual callers. */
let downloadInFlight: Promise<void> | null = null;

/** Download and hold a selected release without preparing the installation. */
async function downloadUpdate(release: GithubRelease): Promise<void> {
  if (state.preparedVersion === release.version || isUpdateBusy(state.phase)) {
    return;
  }
  if (downloadInFlight) {
    await downloadInFlight;
    return;
  }
  refreshSettings();
  if (!state.publicKey) {
    set({ phase: "error", errorCode: "public-key", errorDetail: "" });
    return;
  }
  const operation = (async () => {
    set({ phase: "downloading", errorCode: null, errorDetail: "", downloaded: 0, total: null });
    await ensureProgressListener();
    const task = startDownloadTask({
      label: "settings.updates.task.label",
      stage: t("settings.updates.verifying"),
      run: async (signal, report) => {
        const reportProgress = (downloaded: number, total: number | null) => {
          report(
            total
              ? t("settings.updates.downloading", {
                  downloaded: formatMegabytes(downloaded),
                  total: formatMegabytes(total),
                })
              : t("settings.updates.downloadingUnknown", {
                  downloaded: formatMegabytes(downloaded),
                }),
            total && total > 0 ? downloaded / total : null,
          );
        };
        activeDownloadReporter = reportProgress;
        try {
          let version: string;
          try {
            version = await invoke<string>("update_download", {
              repo: state.repo,
              publicKey: state.publicKey,
              tag: release.tag,
              prerelease: release.prerelease,
            });
          } catch (error) {
            if (signal.aborted) {
              await invoke("update_discard").catch(() => undefined);
            }
            throw error;
          }
          if (signal.aborted) {
            await invoke("update_discard").catch(() => undefined);
            throw new Error("Update download cancelled.");
          }
          return version;
        } finally {
          if (activeDownloadReporter === reportProgress) {
            activeDownloadReporter = null;
          }
        }
      },
    });
    const outcome: DownloadTaskOutcome = await task.done;
    if (outcome.status === "completed") {
      if (compareVersions(outcome.version, release.version) !== 0) {
        const failure = new Error("The verified update does not match the selected release.");
        set({ phase: "error", errorCode: "install", errorDetail: failure.message });
        return;
      }
      set({ phase: "downloaded", preparedVersion: outcome.version });
      void promptForPreparedUpdate(release);
    } else if (outcome.status === "cancelled") {
      set({ phase: "available", preparedVersion: null, errorCode: null, errorDetail: "" });
    } else {
      const failure = classifyUpdateFailure(outcome.error);
      set({ phase: "error", errorCode: failure.code, errorDetail: failure.detail });
    }
  })();
  downloadInFlight = operation;
  try {
    await operation;
  } finally {
    downloadInFlight = null;
  }
}

/** Download automatically only when the selected connection policy allows it. */
async function autoDownload(release: GithubRelease): Promise<void> {
  if (!state.autoCheck) {
    return;
  }
  const connection = await networkStatus();
  if (!state.autoCheck) {
    return;
  }
  if (!allowsAutomaticDownload(state.downloadPolicy, connection)) {
    return;
  }
  await ensureProgressListener();
  await downloadUpdate(release);
}

/** Ask whether a verified package should restart now or install on the next close. */
async function promptForPreparedUpdate(release: GithubRelease): Promise<void> {
  if (
    state.preparedVersion !== release.version ||
    state.phase === "scheduled" ||
    preparedPromptInFlight
  ) {
    return preparedPromptInFlight ?? Promise.resolve();
  }
  const operation = (async () => {
    const restartNow = await requestUpdatePrompt(release.version);
    if (state.preparedVersion !== release.version) {
      return;
    }
    await installPrepared(
      release.version,
      () => Promise.resolve(release.version),
      false,
      true,
      restartNow,
    );
  })();
  preparedPromptInFlight = operation;
  try {
    await operation;
  } finally {
    if (preparedPromptInFlight === operation) {
      preparedPromptInFlight = null;
    }
  }
}

/** Translate a failed install or local verification into the shared error vocabulary. */
export function classifyUpdateFailure(error: unknown): {
  code: UpdateErrorCode;
  detail: string;
} {
  const detail = error instanceof Error ? error.message : String(error);
  const marker = "update_resource_conflict:";
  const position = detail.indexOf(marker);
  return {
    code:
      position >= 0
        ? "resource-conflict"
        : detail.includes("local_update_key_missing")
          ? "public-key"
          : detail.includes("local_update_helper_")
            ? "local-handoff"
            : detail.includes("local_update_")
              ? "local-invalid"
              : "install",
    detail: position >= 0 ? detail.slice(position + marker.length) : detail,
  };
}

/** Reverify a local installer, then apply it through the same guarded handoff. */
export async function installLocalUpdate(path: string, version: string): Promise<void> {
  if (isUpdateBusy(state.phase)) {
    return;
  }
  refreshSettings();
  if (state.portable) {
    set({ phase: "error", errorCode: "portable", errorDetail: "" });
    return;
  }
  await installPrepared(version, () => invoke<string>("update_load_local", { path }), true);
}

/** Run the shared safety checks, load a prepared installer, and hand off to the host. */
async function installPrepared(
  expectedVersion: string,
  load: () => Promise<string>,
  local = false,
  alreadyDownloaded = false,
  restart = true,
): Promise<void> {
  const safety = updateSafetyBlock();
  if (safety) {
    set({
      phase: "error",
      errorCode: safety,
      errorDetail: "",
    });
    return;
  }
  set({
    phase: "preparing",
    errorCode: null,
    errorDetail: "",
    downloaded: 0,
    total: null,
  });
  let releaseFence: (() => void) | null = null;
  let shellFrozen = false;
  let handedOff = false;
  let previouslyInert = false;
  try {
    await ensureProgressListener();
    set({ phase: alreadyDownloaded ? "preparing" : local ? "verifying" : "downloading" });
    const version = await load();
    if (compareVersions(version, expectedVersion) !== 0) {
      throw new Error("The verified update does not match the selected release.");
    }
    const rechecked = updateSafetyBlock();
    if (rechecked) {
      await invoke("update_discard");
      set({ phase: "error", errorCode: rechecked, errorDetail: "" });
      return;
    }
    releaseFence = acquireLongTaskFence();
    if (!releaseFence) {
      await invoke("update_discard");
      set({ phase: "error", errorCode: "tasks-active", errorDetail: "" });
      return;
    }
    set({ phase: "preparing" });
    await preferences.flush();
    const found = await localService();
    if (!found) {
      throw new Error("The local service is unavailable; cannot snapshot application data.");
    }
    await found.library.checkpoint();
    await invoke("update_prepare", { toVersion: version });
    if (restart) {
      previouslyInert = document.body.inert;
      document.body.inert = true;
      shellFrozen = true;
    }
    const finalBlock = updateSafetyBlock();
    if (finalBlock) {
      await invoke("update_discard");
      set({ phase: "error", errorCode: finalBlock, errorDetail: "" });
      return;
    }
    await invoke("update_install", { version, restart });
    handedOff = true;
    set({ phase: restart ? "installed" : "scheduled" });
  } catch (error) {
    await invoke("update_discard").catch(() => {});
    const failure = classifyUpdateFailure(error);
    set({
      phase: "error",
      errorCode: failure.code,
      errorDetail: failure.detail,
    });
  } finally {
    if (!handedOff) {
      if (shellFrozen) {
        document.body.inert = previouslyInert;
      }
      if (!handedOff || !restart) {
        releaseFence?.();
      }
    }
  }
}
