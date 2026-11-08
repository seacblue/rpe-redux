/**
 * The desktop document host.
 *
 * `TauriDocumentStore` opens, saves, closes and recovers documents through Tauri
 * commands, streams large charts line by line, and `DesktopAssetStore` persists
 * assets; chart rules stay in the document and chart modules.
 */
import { t } from "../../../i18n/index.ts";
import { normalizeChartObjectIdsAsync, type Chart } from "../../global/chart/chart.ts";
import { Channel, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { beginLoading, loadingPaint } from "../../global/document/loading.ts";
import { projectChartForExport } from "../../global/chart/exportProjection.ts";
import { dialogDefaultPath, rememberDialogFile } from "./dialogPath.ts";
import { AssetStore } from "../../media/assetStore.ts";
import { values } from "../../state/values.ts";
import type {
  OpenedDocument,
  AssetChange,
  ChartStreamMessage,
  OpenResult,
  SaveOptions,
  RecoverySummary,
  RecoveryDraft,
  DocumentDiskChangePayload,
  SaveResult,
} from "../../global/document/desktopTypes.ts";
import { DOCUMENT_DISK_CHANGE_EVENT } from "../../global/document/desktopTypes.ts";
import type { AssetMap } from "../../global/document/types.ts";
import type { LibraryProjectRef } from "../../global/library/types.ts";
import { localizeDocumentError } from "./documentErrors.ts";
/** Tauri invocation with the shared generic signature used by this host adapter. */
const invoke = async <T>(
  command: string,
  args?: Record<string, unknown> | Uint8Array,
): Promise<T> => tauriInvoke<T>(command, args);

const SAVE_ASSET_MAGIC = new Uint8Array([0x52, 0x50, 0x45, 0x41]);
const SAVE_ASSET_VERSION = 1;

/** Preference keys that keep a pathless recovery family stable across restarts. */
const UNTITLED_RECOVERY_KEY = "redux:recovery:untitled";
const DETACHED_RECOVERY_KEY = "redux:recovery:detached";
/** Retention used when the settings value is unavailable or malformed. */
const DEFAULT_RECOVERY_LIMIT = 10;
const MAX_RECOVERY_LIMIT = 100;
/** Keeps a host without localStorage stable for the lifetime of this module. */
const fallbackRecoveryIds = new Map<string, string>();

/**
 * Read a persisted pathless recovery id.
 *
 * The id is created once and kept in localStorage so a new app start reuses the
 * same draft family instead of leaving the previous family orphaned. Hosts
 * without usable storage fall back to one module-lifetime id.
 */
function stableRecoveryId(key: string): string {
  try {
    const storage = globalThis.localStorage;
    if (storage) {
      const stored = storage.getItem(key);
      if (stored) {
        return stored;
      }
      const created = crypto.randomUUID();
      storage.setItem(key, created);
      return created;
    }
  } catch {
    // A storage-denied host still gets a stable id for this process.
  }
  let fallback = fallbackRecoveryIds.get(key);
  if (!fallback) {
    fallback = crypto.randomUUID();
    fallbackRecoveryIds.set(key, fallback);
  }
  return fallback;
}

/** Retention limit from the settings registry, clamped to the native range. */
function recoveryLimit(): number {
  if (!values.has("autosave-limit")) {
    return DEFAULT_RECOVERY_LIMIT;
  }
  const parsed = Number(values.get<unknown>("autosave-limit"));
  if (!Number.isFinite(parsed)) {
    return DEFAULT_RECOVERY_LIMIT;
  }
  return Math.min(MAX_RECOVERY_LIMIT, Math.max(1, Math.trunc(parsed)));
}

/**
 * The folder a path lives in.
 *
 * A JSON chart keeps its assets relative to itself, so that folder is the only
 * sensible default for an export directory; another location would break the
 * relative asset references.
 */
function parentDirectory(path: string): string | undefined {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : undefined;
}

/** Frame one asset as the native save/recovery asset packet. */
function encodeSaveAsset(sessionId: string, name: string, bytes: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const sessionBytes = encoder.encode(sessionId);
  const nameBytes = encoder.encode(name);
  const headerSize = 13;
  const payload = new Uint8Array(
    headerSize + sessionBytes.length + nameBytes.length + bytes.length,
  );
  payload.set(SAVE_ASSET_MAGIC, 0);
  payload[4] = SAVE_ASSET_VERSION;
  const view = new DataView(payload.buffer);
  view.setUint32(5, sessionBytes.length, true);
  view.setUint32(9, nameBytes.length, true);
  payload.set(sessionBytes, headerSize);
  payload.set(nameBytes, headerSize + sessionBytes.length);
  payload.set(bytes, headerSize + sessionBytes.length + nameBytes.length);
  return payload;
}

const SESSION_CHUNK_MAGIC = new Uint8Array([0x52, 0x50, 0x45, 0x43]);
const SESSION_CHUNK_VERSION = 1;
/** Large enough to amortize IPC, small enough to keep each task well under a frame. */
const CHART_CHUNK_CHARS = 128 * 1024;
const CHART_ENCODER = new TextEncoder();

/** Frame one chart-text chunk for the native streaming writer. */
function encodeSessionChunk(sessionId: string, chunk: Uint8Array): Uint8Array {
  const sessionBytes = new TextEncoder().encode(sessionId);
  const headerSize = 9;
  const payload = new Uint8Array(headerSize + sessionBytes.length + chunk.length);
  payload.set(SESSION_CHUNK_MAGIC, 0);
  payload[4] = SESSION_CHUNK_VERSION;
  new DataView(payload.buffer).setUint32(5, sessionBytes.length, true);
  payload.set(sessionBytes, headerSize);
  payload.set(chunk, headerSize + sessionBytes.length);
  return payload;
}

/**
 * Send chart text in bounded raw chunks.
 *
 * One multi-megabyte JSON string in a single Tauri invocation turns into a
 * long main-thread task. The native side appends each chunk and parses the
 * complete document on its blocking worker.
 */
async function writeChartChunks(
  command: "write_save_chart" | "write_recovery_chart",
  sessionId: string,
  text: string,
  onProgress?: (value: number) => void,
): Promise<void> {
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(text.length, offset + CHART_CHUNK_CHARS);
    // Never split a surrogate pair between two JSON chunks.
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) {
      end -= 1;
    }
    const bytes = CHART_ENCODER.encode(text.slice(offset, end));
    await invoke(command, encodeSessionChunk(sessionId, bytes));
    offset = end;
    onProgress?.(offset / Math.max(1, text.length));
  }
}

/** Translate a native save failure into a localized error carrying the native code. */
export function localizeSaveError(error: unknown): Error {
  const code = error instanceof Error ? error.message : String(error);
  return localizeDocumentError(new Error(code), "save");
}

/** Normalize a native open failure into its matching explanation and solution. */
export function localizeOpenError(error: unknown): Error {
  const failure = error instanceof Error ? error : new Error(String(error));
  if (failure.name === "AbortError") {
    return failure;
  }
  return localizeDocumentError(failure, "open");
}

/**
 * Fill in the disk snapshot of a freshly created package.
 *
 * A saved result that already carries a snapshot is returned unchanged; `probe`
 * reads the host snapshot for the new file.
 */
export async function hydratePostSaveSnapshot(
  result: Extract<SaveResult, { status: "saved" }>,
  probe: () => Promise<string | null>,
): Promise<Extract<SaveResult, { status: "saved" }>> {
  if (result.disk_snapshot !== undefined && result.disk_snapshot !== null) {
    return result;
  }
  return { ...result, disk_snapshot: await probe() };
}

/** The local document a save may reuse as its target. */
export interface LocalSaveBinding {
  readonly project: LibraryProjectRef | null;
  readonly sourcePath: string | null;
}

/**
 * Choose the inherited local target for a save.
 *
 * A joined room owns the live chart, not the guest's previous file or library
 * project. `detached` clears both fields so the save creates a new local copy
 * instead of overwriting the document the guest had open before joining.
 */
export function selectLocalSaveBinding(
  detached: boolean,
  project: LibraryProjectRef | null,
  sourcePath: string | null,
): LocalSaveBinding {
  return detached ? { project: null, sourcePath: null } : { project, sourcePath };
}

/**
 * Asset map for one open desktop document.
 *
 * Bytes are read from the native document on demand and cached; `changes`
 * compares the current map with the bytes the document was opened with.
 */
export class DesktopAssetStore extends AssetStore {
  /** Native document id used in asset URLs and read commands. */
  id: string;
  /** Whether the source document is a packed archive without editable paths. */
  packed: boolean;

  /** Initialize names from the opened document and bind the shared asset map. */
  constructor(opened: OpenedDocument) {
    super();
    this.id = opened.id;
    this.packed = Boolean(opened.packed);
    for (const entry of opened.entries) {
      this.names.add(entry.name);
    }
    this.attach(this.assets);
  }
  /** Bind a new asset map and expose URL, read, and name lookups on it. */
  attach(assets: AssetMap): void {
    for (const name of this.assets.keys()) {
      if (!assets.has(name)) {
        this.names.delete(name);
      }
    }
    for (const name of assets.keys()) {
      this.names.add(name);
    }
    this.assets = assets;
    assets.uri = (name: string) => this.url(name);
    assets.read = (name: string) => this.read(name);
    assets.names = () => this.names;
  }
  /** Stable pseudo-URL the webview can request for one asset. */
  override url(name: string): string {
    return `http://redux.localhost/${this.id}/${encodeURIComponent(name)}`;
  }
  /** Return cached bytes, otherwise read them from the native document and cache. */
  override async read(name: string): Promise<Uint8Array | undefined> {
    if (this.assets.get(name)) {
      return this.assets.get(name);
    }
    const response = await invoke<ArrayBuffer | number[]>("read_asset", {
      id: this.id,
      name,
    });
    const bytes =
      response instanceof ArrayBuffer ? new Uint8Array(response) : Uint8Array.from(response);
    this.original.set(name, bytes);
    this.assets.set(name, bytes);
    return bytes;
  }
  /** Read every matching asset eagerly and return the materialized map. */
  async materialize(pattern = /./): Promise<AssetMap> {
    for (const name of this.names) {
      if (pattern.test(name)) {
        await this.read(name);
      }
    }
    return this.assets;
  }
  /** Refresh selected loose-document resources after an external save. */
  async refreshFromDisk(
    assets: AssetMap,
    pattern = /\.(?:glsl|frag|vert|vsh|fsh|shader|png|jpe?g|webp|gif|bmp|avif|mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i,
  ): Promise<string[]> {
    if (this.packed) {
      return [];
    }
    const changed: string[] = [];
    for (const name of this.names) {
      if (!pattern.test(name)) {
        continue;
      }
      const response = await invoke<ArrayBuffer | number[]>("read_asset", {
        id: this.id,
        name,
      });
      const next =
        response instanceof ArrayBuffer ? new Uint8Array(response) : Uint8Array.from(response);
      const previous = assets.get(name);
      if (
        !previous ||
        previous.length !== next.length ||
        previous.some((value, index) => value !== next[index])
      ) {
        assets.set(name, next);
        this.original.set(name, next);
        changed.push(name);
      }
    }
    return changed;
  }
  /** Assets whose bytes differ from what the document was opened with. */
  changes(assets: ReadonlyMap<string, Uint8Array>): AssetChange[] {
    return [...assets]
      .filter(([name, bytes]) => this.original.get(name) !== bytes)
      .map(([name, bytes]) => ({ name, bytes }));
  }
}

/** Caller-controlled options for one native document open. */
export interface OpenDocumentOptions {
  /**
   * Grant the external resources this document references for this document
   * only. The native host records the grant before reading the chart again.
   */
  allowExternalResources?: boolean;
}

/** Tauri-backed document store for open, save, recovery, and close. */
export class TauriDocumentStore {
  /** Currently open document, or null when nothing is open. */
  current: OpenedDocument | null;
  /** Assets of the current document, or null when nothing is open. */
  assets: DesktopAssetStore | null;
  /** Session id used for recovery writes before a document has a path. */
  recoveryId: string;
  /** Incremented per open request so a superseded open can cancel itself. */
  openRevision: number;
  /** Whether recovery writes should ignore the mounted native document. */
  private recoveryDetached: boolean;
  private readonly serializeChart?: (chart: unknown) => Promise<string>;

  /**
   * @param serializeChart Turns a recovery snapshot into JSON away from the UI
   * thread. Without it the Tauri bridge has to serialize the object graph on
   * the interaction thread before the command can run.
   */
  constructor(serializeChart?: (chart: unknown) => Promise<string>) {
    this.serializeChart = serializeChart;
    this.current = null;
    this.assets = null;
    this.recoveryId = stableRecoveryId(UNTITLED_RECOVERY_KEY);
    this.openRevision = 0;
    this.recoveryDetached = false;
  }
  /**
   * Open a chart and stream its lines, replacing any current document.
   *
   * `allowExternalResources` grants the chart's out-of-folder references for
   * this document only; the native result still reports references that cannot
   * be granted, such as relative paths that escape the folder. Throws an
   * `AbortError` when a newer open request supersedes this one; the superseded
   * native document is closed before throwing.
   */
  async open(path: string, options: OpenDocumentOptions = {}): Promise<OpenResult> {
    const task = beginLoading(path.split(/[\\/]/).at(-1) ?? path);
    try {
      await loadingPaint();
      const revision = ++this.openRevision;
      const onProgress = new Channel<{ completed: number; total: number }>();
      onProgress.onmessage = ({ completed, total }) => task.update("unpack", completed, total);
      const onChart = new Channel<ChartStreamMessage>();
      let chartHeader: Record<string, unknown> | null = null;
      const chartLines: unknown[] = [];
      let resolveChartDone = () => {};
      const chartDone = new Promise<void>((resolve) => {
        resolveChartDone = resolve;
      });
      onChart.onmessage = (message) => {
        if (message.kind === "header") {
          chartHeader = message.chart;
        } else if (message.kind === "lines") {
          chartLines.push(...message.lines);
        } else {
          resolveChartDone();
        }
      };
      task.update("read", 1, 1);
      let opened: OpenedDocument;
      try {
        opened = await invoke<OpenedDocument>("open_document", {
          path,
          onProgress,
          onChart,
          allowExternalResources: options.allowExternalResources === true,
        });
      } catch (error) {
        throw localizeOpenError(error);
      }
      task.update("parse", 1, 1);
      if (revision !== this.openRevision) {
        await invoke("close_document", { id: opened.id });
        throw Object.assign(new Error(t("system.document.loadCancelled")), { name: "AbortError" });
      }
      await chartDone;
      const streamedHeader = chartHeader as Record<string, unknown> | null;
      const chart = streamedHeader
        ? { ...streamedHeader, judgeLineList: chartLines }
        : opened.chart;
      if (chart && typeof chart === "object") {
        await normalizeChartObjectIdsAsync(chart as Chart);
      }
      delete opened.chart;
      const previous = this.current;
      this.current = opened;
      this.recoveryDetached = false;
      this.assets?.release();
      this.assets = new DesktopAssetStore(opened);
      if (previous) {
        await invoke("close_document", { id: previous.id });
      }
      await this.assets.materialize(/(?:info\.txt|extra\.json|\.(?:glsl|vsh))$/i);
      return {
        candidate: { chart, name: opened.chart_name, desktop: opened },
        assets: this.assets.assets,
        task,
      };
    } catch (error) {
      task.fail(error);
      throw error;
    }
  }
  /** Ask for a chart file and open it; returns null when the picker is cancelled. */
  async chooseOpen(): Promise<OpenResult | null> {
    const path = await this.chooseOpenPath();
    return path ? this.open(path) : null;
  }
  /** Ask for a chart path and remember its folder; null on cancel. */
  async chooseOpenPath(): Promise<string | null> {
    const path = await (
      await import("@tauri-apps/plugin-dialog")
    ).open({
      multiple: false,
      defaultPath: dialogDefaultPath("chart"),
      filters: [{ name: t("system.document.chartFilter"), extensions: ["json", "pez", "zip"] }],
    });
    if (typeof path === "string") {
      rememberDialogFile("chart", path);
    }
    return path;
  }
  /** Read the current document's disk snapshot for self-write detection. */
  diskSnapshot(): Promise<string | null> {
    const id = this.current?.id;
    return id ? invoke<string>("document_disk_snapshot", { id }) : Promise.resolve(null);
  }
  /** Notify when the host reports a disk change for the current document. */
  listenForDiskChanges(listener: () => void): Promise<UnlistenFn> {
    return listen<DocumentDiskChangePayload>(DOCUMENT_DISK_CHANGE_EVENT, ({ payload }) => {
      // Keep the subscription alive across document replacements. The native
      // watcher identifies the document id; the current store owns whether that
      // id is still relevant to the mounted editor.
      if (payload.documentId === this.current?.id) {
        listener();
      }
    });
  }
  /**
   * Save the chart and changed assets through the native staged-write session.
   *
   * Returns null when a picker is cancelled, and a `save_conflict` result when
   * the on-disk snapshot moved since it was read.
   */
  async save(
    chart: unknown,
    assets: AssetMap,
    saveAs = false,
    options: SaveOptions = {},
  ): Promise<SaveResult | null> {
    const current = this.current,
      store = this.assets;
    // File documents are export containers even when saved in place. Project
    // editor-only noise-line settings, preserve the declared RPE version, and
    // write the Redux export marker before the native host serializes the chart;
    // the library stores the working chart separately.
    if (typeof chart !== "string") {
      chart = projectChartForExport(
        chart as Chart,
        options.name ?? options.path ?? current?.chart_name ?? "",
      );
    }
    const changes: AssetChange[] = store
      ? store.changes(assets)
      : [...assets].map(([name, bytes]) => ({ name, bytes }));
    const extension = options.format ?? (current?.packed || changes.length ? "pez" : "json");
    let path =
      options.path ??
      (saveAs || !current
        ? await (
            await import("@tauri-apps/plugin-dialog")
          ).save({
            defaultPath:
              current?.path ?? dialogDefaultPath("chart", options.name ?? `chart.${extension}`),
            filters: [
              {
                name: t("system.document.chartFilter"),
                extensions: options.format ? [extension] : ["json", "pez"],
              },
            ],
          })
        : current.path);
    if (!path) {
      return null;
    }
    rememberDialogFile("chart", path);
    const assetNames = new Set(assets.names?.() ?? assets.keys());
    if (!/\.(json|pez)$/i.test(path)) {
      path += `.${extension}`;
    }
    let extractTo: string | null = null;
    if ((current?.packed || changes.length) && /\.json$/i.test(path)) {
      extractTo = await (
        await import("@tauri-apps/plugin-dialog")
      ).open({
        directory: true,
        title: t("system.document.extractDirectory"),
        // Default to the folder that holds the chart: assets are referenced
        // relative to it, so anywhere else would write `../..` into the project.
        defaultPath: parentDirectory(path),
      });
      if (!extractTo) {
        return null;
      }
    }
    let sessionId: string | null = null;
    let result: SaveResult;
    const onProgress = options.onProgress;
    try {
      const chartText = typeof chart === "string" ? chart : null;
      onProgress?.(0.04);
      sessionId = await invoke<string>("begin_save_document", {
        request: {
          id: current?.id ?? null,
          path,
          chart: chartText ? null : chart,
          diskSnapshot: !saveAs && current?.path === path ? (current.disk_snapshot ?? null) : null,
          removed: store ? [...store.names].filter((name) => !assetNames.has(name)) : [],
          extractTo,
          export: Boolean(options.export),
        },
      });
      onProgress?.(0.08);
      if (chartText) {
        await writeChartChunks("write_save_chart", sessionId, chartText, (value) =>
          onProgress?.(0.08 + value * 0.47),
        );
      } else {
        onProgress?.(0.55);
      }
      for (const [index, change] of changes.entries()) {
        await invoke("write_save_asset", encodeSaveAsset(sessionId, change.name, change.bytes));
        onProgress?.(0.55 + ((index + 1) / Math.max(1, changes.length)) * 0.4);
      }
      result = await invoke<SaveResult>("finish_save_document", { sessionId });
      onProgress?.(1);
    } catch (error) {
      if (sessionId) {
        await invoke("cancel_save_document", { sessionId }).catch(() => {});
      }
      throw localizeSaveError(error);
    }
    if (result.status === "save_conflict") {
      return result;
    }
    const active = this.current;
    if (!options.export && active === current) {
      if (active) {
        active.path = result.path;
        active.packed = result.packed;
        active.chart_name = result.chart_name;
        active.disk_snapshot = result.disk_snapshot ?? active.disk_snapshot;
      } else {
        const opened = await invoke<OpenedDocument>("open_document", {
          path: result.path,
          includeChart: false,
        });
        delete opened.chart;
        this.current = opened;
        this.assets = new DesktopAssetStore(opened);
        result = await hydratePostSaveSnapshot(result, () =>
          invoke<string>("document_disk_snapshot", { id: opened.id }),
        );
      }
      const target = this.assets;
      if (target) {
        for (const [name, bytes] of assets) {
          if (bytes) {
            target.original.set(name, bytes);
          }
        }
      }
    }
    if (!options.export && this.current === current && this.assets) {
      this.assets.names = new Set(assets.names?.() ?? assets.keys());
    }
    return result;
  }
  /** Save under a newly chosen path. */
  saveAs(chart: unknown, assets: AssetMap): Promise<SaveResult | null> {
    return this.save(chart, assets, true);
  }
  /** Write an export copy without taking over the current document. */
  export(chart: unknown, assets: AssetMap, options: SaveOptions): Promise<SaveResult | null> {
    return this.save(chart, assets, true, { ...options, export: true });
  }
  /**
   * Write one official JSON or PEC text export.
   *
   * The native save dialog owns the destination; the returned path is null when
   * the user cancels.
   */
  async exportText(
    text: string,
    options: { name: string; extension: "json" | "pec"; filter: string },
  ): Promise<string | null> {
    const { save } = await import("@tauri-apps/plugin-dialog");
    let path = await save({
      defaultPath: dialogDefaultPath("chart", options.name),
      filters: [{ name: options.filter, extensions: [options.extension] }],
    });
    if (!path) {
      return null;
    }
    if (!path.toLowerCase().endsWith(`.${options.extension}`)) {
      path += `.${options.extension}`;
    }
    rememberDialogFile("chart", path);
    return invoke<string>("write_export_text", { path, text });
  }
  /**
   * Detach recovery writes from the mounted native document.
   *
   * A room chart replaces the chart the previous document path or recovery id
   * belonged to, so the room's autosaves must not prune the pre-join draft. A
   * later {@link open} binds recovery to the new document again.
   */
  detachRecoveryTarget(): void {
    this.recoveryDetached = true;
    this.recoveryId = stableRecoveryId(DETACHED_RECOVERY_KEY);
  }
  /** Write a recovery snapshot for the current document or the untitled session. */
  async recover(
    chart: unknown,
    assets: AssetMap = new Map(),
    viewState: Record<string, unknown> = {},
    onProgress?: (value: number) => void,
  ): Promise<unknown> {
    // Capture the target before serialization awaits. A caller may detach or
    // close the native document while a displaced chart is being serialized,
    // and that snapshot still belongs to the document it was taken from.
    const current = this.recoveryDetached ? null : this.current;
    const recoveryId = this.recoveryId;
    const changes: AssetChange[] =
      this.assets && !this.recoveryDetached
        ? this.assets.changes(assets)
        : [...assets].map(([name, bytes]) => ({ name, bytes }));
    const chartText = this.serializeChart ? await this.serializeChart(chart) : null;
    onProgress?.(0.04);
    const sessionId = await invoke<string>("begin_recovery", {
      request: {
        id: current?.id ?? recoveryId,
        path: current?.path ?? null,
        chart: chartText ? null : chart,
        viewState,
        limit: recoveryLimit(),
      },
    });
    onProgress?.(0.08);
    try {
      if (chartText) {
        await writeChartChunks("write_recovery_chart", sessionId, chartText, (value) =>
          onProgress?.(0.08 + value * 0.47),
        );
      } else {
        onProgress?.(0.55);
      }
      for (const [index, change] of changes.entries()) {
        await invoke("write_recovery_asset", encodeSaveAsset(sessionId, change.name, change.bytes));
        onProgress?.(0.55 + ((index + 1) / Math.max(1, changes.length)) * 0.4);
      }
      const result = await invoke("finish_recovery", { sessionId });
      onProgress?.(1);
      return result;
    } catch (error) {
      await invoke("cancel_recovery", { sessionId }).catch(() => {});
      throw error;
    }
  }
  /** List recoverable drafts known to the native host. */
  listRecovery(): Promise<RecoverySummary[]> {
    return invoke<RecoverySummary[]>("list_recovery");
  }
  /** Read one recovery draft. */
  readRecovery(id: string): Promise<RecoveryDraft> {
    return invoke<RecoveryDraft>("read_recovery", { id });
  }
  /** Delete one recovery draft; returns whether a draft was removed. */
  deleteRecovery(id: string): Promise<boolean> {
    return invoke<boolean>("delete_recovery", { id });
  }
  /** Close the current native document and release its asset store. */
  async close(): Promise<void> {
    this.openRevision++;
    const current = this.current;
    this.current = null;
    this.assets?.release();
    this.assets = null;
    if (current) {
      await invoke("close_document", { id: current.id });
    }
  }
}
