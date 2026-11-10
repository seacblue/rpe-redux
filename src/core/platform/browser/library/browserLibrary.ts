/**
 * Browser chart-library client.
 *
 * It implements the same surface as the loopback HTTP client, but sends each
 * operation to the SQLite WASM worker and owns the blob URLs for project assets.
 * The web host selects it only when no local sidecar is available.
 */
import {
  BROWSER_LIBRARY_ORIGIN,
  LocalLibrary,
  LocalLibraryError,
  type BackendInstance,
  type InstanceList,
  type LibraryAssetSummary,
  type LibraryCommitInput,
  type LibraryCommitResult,
  type LibraryProject,
  type LibraryProjectSummary,
  type LibraryRevision,
  type LibraryRevisionSummary,
  type ListQuery,
  type OccupancyAcquireInput,
  type ProjectPatch,
  type RequestOptions,
} from "../../../global/library/client.ts";
import type { DropClassification } from "../../../global/document/dropIntake.ts";
import {
  cacheProjectAssetUrl,
  cachedProjectAssetUrl,
  clearProjectAssetUrls,
} from "../../../global/library/assetUrlCache.ts";

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  bytes?: ArrayBuffer;
  error?: { code?: string; message?: string };
}

interface PendingCall {
  resolve(value: WorkerResponse): void;
  reject(error: Error): void;
}

/** Browser-library errors map worker codes back to the service envelope. */
function browserError(error: WorkerResponse["error"]): LocalLibraryError {
  const code = error?.code ?? "browser_library_error";
  const status =
    code === "not_found" ? 404 : code === "revision_conflict" || code === "occupied" ? 409 : 400;
  return new LocalLibraryError(error?.message ?? "browser library request failed", {
    code,
    status,
  });
}

/** The in-browser SQLite library. */
export class BrowserLibrary extends LocalLibrary {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingCall>();
  private readonly ready: Promise<WorkerResponse>;
  private nextId = 1;
  private tail: Promise<void> = Promise.resolve();

  private constructor() {
    super(BROWSER_LIBRARY_ORIGIN);
    this.worker = new Worker(new URL("./db.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data);
    this.worker.onerror = (event) => this.fail(new Error(event.message || "library worker failed"));
    this.ready = this.send("init");
  }

  /** Open the browser library and wait for the SQLite schema to be ready. */
  static async open(): Promise<BrowserLibrary> {
    const library = new BrowserLibrary();
    await library.ready;
    return library;
  }

  /** Resolve one worker response into the pending caller. */
  private receive(response: WorkerResponse): void {
    const entry = this.pending.get(response.id);
    if (!entry) {
      return;
    }
    this.pending.delete(response.id);
    if (response.ok) {
      entry.resolve(response);
    } else {
      entry.reject(browserError(response.error));
    }
  }

  /** Reject every in-flight call when the worker fails. */
  private fail(error: Error): void {
    for (const entry of this.pending.values()) {
      entry.reject(error);
    }
    this.pending.clear();
  }

  /** Send one request without queueing; only init and the queue itself use it. */
  private send(method: string, params?: Record<string, unknown>): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, params });
    });
  }

  /** Serialize requests so one worker connection never runs two operations at once. */
  private call(method: string, params?: Record<string, unknown>): Promise<WorkerResponse> {
    const run = this.tail.then(() => this.send(method, params));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Read the result of one queued request. */
  private async result<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.call(method, params);
    return response.result as T;
  }

  /** Read one transferred byte result. */
  private async bytes(method: string, params?: Record<string, unknown>): Promise<Uint8Array> {
    const response = await this.call(method, params);
    if (!response.bytes) {
      throw new LocalLibraryError("browser library returned no bytes", {
        code: "browser_library_error",
        status: 500,
      });
    }
    return new Uint8Array(response.bytes);
  }

  /** Materialize the manifest's bytes as live blob URLs for the media layer. */
  private async cacheAssets(id: string, manifest: readonly LibraryAssetSummary[]): Promise<void> {
    await Promise.all(
      manifest.map(async (asset) => {
        if (cachedProjectAssetUrl(this.origin, id, asset.name)) {
          return;
        }
        const bytes = await this.asset(id, asset.name);
        cacheProjectAssetUrl(
          this.origin,
          id,
          asset.name,
          URL.createObjectURL(new Blob([bytes.slice().buffer])),
        );
      }),
    );
  }

  /** A browser tab is its own backend instance; no sidecar owns a lease. */
  private instance(id: string, label: string, frontendPort?: number): BackendInstance {
    const now = new Date().toISOString();
    return {
      id,
      label,
      ...(frontendPort ? { frontendPort } : {}),
      pid: 0,
      startedAt: now,
      heartbeatAt: now,
    };
  }

  override health(_options: RequestOptions = {}): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }

  override classifyDropped(
    _paths: readonly string[],
    _options: RequestOptions = {},
  ): Promise<{ items: DropClassification[] }> {
    return Promise.reject(
      new LocalLibraryError("Dropped local paths are unavailable in the browser library", {
        code: "unsupported",
        status: 501,
      }),
    );
  }

  override instancesRegister(
    input: { id: string; label: string; pid?: number; frontendPort?: number },
    _options: RequestOptions = {},
  ): Promise<{ backendId: string; instance: BackendInstance }> {
    return Promise.resolve({
      backendId: "browser",
      instance: this.instance(input.id, input.label, input.frontendPort),
    });
  }

  override instancesList(_options: RequestOptions = {}): Promise<InstanceList> {
    return Promise.resolve({ backendId: "browser", instances: [], locks: [] });
  }

  override instancesHeartbeat(
    _id: string,
    _options: RequestOptions = {},
  ): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }

  override instancesLeave(
    _id: string,
    _options: RequestOptions = {},
  ): Promise<{ remaining: number }> {
    return Promise.resolve({ remaining: 0 });
  }

  override instancesClear(
    _id: string,
    _options: RequestOptions = {},
  ): Promise<{ cleared: number }> {
    return Promise.resolve({ cleared: 0 });
  }

  override instancesPrune(_options: RequestOptions = {}): Promise<InstanceList> {
    return Promise.resolve({ backendId: "browser", instances: [], locks: [] });
  }

  override occupancyAcquire(
    input: OccupancyAcquireInput,
    _options: RequestOptions = {},
  ): Promise<{ backendId: string; owner: BackendInstance }> {
    return Promise.resolve({
      backendId: "browser",
      owner: this.instance(input.instanceId, input.label ?? "RPE Redux", input.frontendPort),
    });
  }

  override occupancyRelease(
    _input: { documentKey: string; instanceId: string },
    _options: RequestOptions = {},
  ): Promise<{ released: boolean }> {
    return Promise.resolve({ released: true });
  }

  override occupancyClearBackend(
    _documentKey: string,
    _options: RequestOptions = {},
  ): Promise<{ cleared: boolean }> {
    return Promise.resolve({ cleared: false });
  }

  override occupancyReconcile(
    input: { documentKey: string; instanceId: string },
    _options: RequestOptions = {},
  ): Promise<{ backendId: string; available: boolean; owner: BackendInstance }> {
    return Promise.resolve({
      backendId: "browser",
      available: true,
      owner: this.instance(input.instanceId, "RPE Redux"),
    });
  }

  override list(
    query: ListQuery = {},
    _options: RequestOptions = {},
  ): Promise<{ projects: LibraryProjectSummary[]; total: number }> {
    return this.result("list", { query });
  }

  override get(id: string, _options: RequestOptions = {}): Promise<{ project: LibraryProject }> {
    return this.result("get", { id });
  }

  override create(
    input: { name: string; group?: string; chart: unknown },
    _options: RequestOptions = {},
  ): Promise<{ project: LibraryProjectSummary }> {
    return this.result("create", {
      name: input.name,
      group: input.group ?? "",
      chart: input.chart,
    });
  }

  override createRaw(
    input: { name: string; group?: string; chartJson: string },
    _options: RequestOptions = {},
  ): Promise<{ project: LibraryProjectSummary }> {
    return this.result("create", {
      name: input.name,
      group: input.group ?? "",
      chartJson: input.chartJson,
    });
  }

  override update(
    id: string,
    patch: ProjectPatch,
    _options: RequestOptions = {},
  ): Promise<{ project: LibraryProjectSummary }> {
    return this.result("update", { id, patch });
  }

  override async remove(id: string, _options: RequestOptions = {}): Promise<{ deleted: boolean }> {
    const result = await this.result<{ deleted: boolean }>("remove", { id });
    clearProjectAssetUrls(this.origin, id);
    return result;
  }

  override duplicate(
    id: string,
    name: string,
    _options: RequestOptions = {},
  ): Promise<{ project: LibraryProjectSummary }> {
    return this.result("duplicate", { id, name });
  }

  override async assets(
    id: string,
    _options: RequestOptions = {},
  ): Promise<{ assets: LibraryAssetSummary[] }> {
    const result = await this.result<{ assets: LibraryAssetSummary[] }>("assets", { id });
    await this.cacheAssets(id, result.assets);
    return result;
  }

  override assetUrl(id: string, name: string): string {
    return cachedProjectAssetUrl(this.origin, id, name) ?? "";
  }

  override asset(id: string, name: string, _options: RequestOptions = {}): Promise<Uint8Array> {
    return this.bytes("asset", { id, name });
  }

  override stageAsset(
    id: string,
    name: string,
    bytes: Uint8Array,
    _options: RequestOptions = {},
  ): Promise<{ asset: LibraryAssetSummary; staged: boolean }> {
    return this.result("stageAsset", { id, name, bytes });
  }

  override commit(
    id: string,
    input: LibraryCommitInput,
    _options: RequestOptions = {},
  ): Promise<LibraryCommitResult> {
    return this.result("commit", { id, input });
  }

  override revisions(
    id: string,
    { limit }: { limit?: number } = {},
    _options: RequestOptions = {},
  ): Promise<{ revisions: LibraryRevisionSummary[] }> {
    return this.result("revisions", { id, limit });
  }

  override createRevision(
    id: string,
    input: { chart: unknown; label: string },
    _options: RequestOptions = {},
  ): Promise<{ revision: LibraryRevisionSummary }> {
    return this.result("createRevision", {
      id,
      chart: input.chart,
      label: input.label,
    });
  }

  override revision(
    id: string,
    _options: RequestOptions = {},
  ): Promise<{ revision: LibraryRevision }> {
    return this.result("revision", { id });
  }

  override removeRevision(
    id: string,
    _options: RequestOptions = {},
  ): Promise<{ deleted: boolean }> {
    return this.result("removeRevision", { id });
  }

  override preferences(
    _options: RequestOptions = {},
  ): Promise<{ values: Record<string, unknown> }> {
    return this.result("preferences");
  }

  override savePreferences(
    values: Record<string, unknown>,
    _options: RequestOptions = {},
  ): Promise<{ values: Record<string, unknown> }> {
    return this.result("savePreferences", { values });
  }

  override checkpoint(_options: RequestOptions = {}): Promise<{ ok: boolean }> {
    return this.result("checkpoint");
  }

  /** Snapshot the whole library as a standalone SQLite file. */
  exportDatabase(): Promise<Uint8Array> {
    return this.bytes("export");
  }

  /** Current browser quota and persistent-storage state. */
  async storageStatus(): Promise<{ persisted: boolean; usage: number; quota: number }> {
    const storage = navigator.storage;
    const persisted = storage?.persisted ? await storage.persisted() : false;
    const estimate = storage?.estimate ? await storage.estimate() : {};
    return {
      persisted,
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    };
  }

  /** Ask the browser for persistent storage; the browser decides the answer. */
  async requestPersistence(): Promise<boolean> {
    return navigator.storage?.persist ? navigator.storage.persist() : false;
  }
}

let opened: Promise<BrowserLibrary> | null = null;

/** Open the one browser library for this page, or return the in-flight open. */
export function openBrowserLibrary(): Promise<BrowserLibrary> {
  opened ??= BrowserLibrary.open().catch((error: unknown) => {
    opened = null;
    throw error;
  });
  return opened;
}
