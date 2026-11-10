/* eslint-disable max-lines -- this transport file mirrors the backend route table; splitting it would scatter one contract across files. */
// HTTP client for the local Go + SQLite service in `src/backend/`.
//
// The desktop build owns both documents on disk (Tauri commands) and the
// durable library (this service). Everything here is transport and payload
// validation with no DOM access; payload shapes mirror `src/backend/store.go`,
// which is what the settings panel and library catalogue read.

import { t } from "../../../i18n/index.ts";
import { beginBackendTrace } from "../../diagnostics/backendTrace.ts";
import { PREFERENCE_SECTIONS, preferences } from "../../state/preferences.ts";
import { browserDevPorts, getRuntimePorts } from "../../platform/runtimePorts.ts";
import { isDesktop } from "../../platform/environment.ts";
import { cachedProjectAssetUrl } from "./assetUrlCache.ts";
import { LocalLibraryError, request, type RequestOptions } from "./http.ts";
import { ChartFrameDecoder, decodeLinesFrame } from "../chart/streaming/chartStreamCodec.ts";
import { CHART_FRAME } from "../chart/streaming/chartStreamTypes.ts";
import type { LibraryViewState } from "./types.ts";
import type { DropClassification } from "../document/dropIntake.ts";

export { LocalLibraryError, type RequestOptions } from "./http.ts";

/** Default loopback origin of the local service. */
export const DEFAULT_SERVER_ORIGIN = "http://127.0.0.1:47821";

/** Synthetic origin used by the in-browser SQLite library. */
export const BROWSER_LIBRARY_ORIGIN = "opfs://rpe-redux";

/** Origin of the configured local Code Cell listener. */
export function aiServiceOrigin(): string {
  return `http://127.0.0.1:${getRuntimePorts().aiPort}`;
}

/** A stored chart project, as `store.ProjectSummary` serialises it. */
export interface LibraryProjectSummary {
  id: string;
  name: string;
  group: string;
  archived: boolean;
  charter: string;
  composer: string;
  level: string;
  /** Cover asset name, resolved by the service when the chart was written. */
  background?: string;
  /** Audio asset name, resolved by the service when the chart was written. */
  song?: string;
  noteCount: number;
  /** Optimistic-concurrency token; advances only when the chart or assets change. */
  revision: number;
  createdAt: string;
  updatedAt: string;
  size: number;
  viewState?: LibraryViewState;
  assetFolders?: string[];
}

/** A blob attached to a project by name. The bytes live in the asset table. */
export interface LibraryAssetSummary {
  name: string;
  hash: string;
  size: number;
}

/** One atomic commit: chart text plus the complete asset manifest. */
export interface LibraryCommitInput {
  baseRevision?: number;
  name?: string;
  /** Already serialized by the caller's worker; the service validates it. */
  chartJson: string;
  /** Complete name/hash manifest, not just the changed entries. */
  assets: readonly { name: string; hash: string }[];
  viewState?: LibraryViewState;
  assetFolders?: readonly string[];
  label?: string;
  snapshot?: boolean;
}

/** Result of committing a chart: the project summary after the write. */
export interface LibraryCommitResult {
  project: LibraryProjectSummary;
}

/** A stored chart project including its chart document. */
export interface LibraryProject extends LibraryProjectSummary {
  chart: unknown;
}

/** Stored revision without its chart document. */
export interface LibraryRevisionSummary {
  id: string;
  projectId: string;
  label: string;
  createdAt: string;
  size: number;
}

/** Stored revision including its chart document. */
export interface LibraryRevision extends LibraryRevisionSummary {
  chart: unknown;
}

/** Automatic snapshot policy shared by desktop, web, and remote services. */
export interface LibraryBackupPolicy {
  auto: boolean;
  pollSeconds: number;
  debounceSeconds: number;
  maxDelaySeconds: number;
  keepCommits: number;
}

/** One whole-library snapshot returned by the backup service. */
export interface LibraryBackupSummary {
  id: string;
  parent?: string;
  reason: string;
  createdAt: string;
  stats: {
    projects: number;
    assets: number;
    revisions: number;
    objects: number;
    rawBytes: number;
  };
  sourceHost: string;
}

/** Current backup store state. */
export interface LibraryBackupStatus {
  enabled: boolean;
  head: string | null;
  healthy: boolean;
  commits: number;
  objects: number;
  bytes: number;
  liveBytes: number;
  lastBackupAt: string | null;
  lastError: string | null;
  policy: LibraryBackupPolicy;
}

/** Full object verification result. */
export interface LibraryBackupVerifyReport {
  checkedCommits: number;
  checkedObjects: number;
  missing: string[];
  corrupt: string[];
}

/** Retention pass result. */
export interface LibraryBackupCompactReport {
  beforeCommits: number;
  afterCommits: number;
  deletedCommits: number;
  deletedObjects: number;
  beforeBytes?: number;
  afterBytes?: number;
}

/** One live editor copy registered with the shared backend. */
export interface BackendInstance {
  id: string;
  label: string;
  /** TCP port of the editor's own frontend, for human-readable diagnostics. */
  frontendPort?: number;
  pid: number;
  startedAt: string;
  heartbeatAt: string;
  locks?: string[];
}

/** One document occupancy record held by a frontend instance. */
export interface DocumentLock {
  documentKey: string;
  chartName: string;
  instanceId: string;
  acquiredAt: string;
  heartbeatAt: string;
}

/** Live instances and the document locks registered with the backend. */
export interface InstanceList {
  backendId: string;
  instances: BackendInstance[];
  locks: DocumentLock[];
}

/** Request to claim one document for an instance. */
export interface OccupancyAcquireInput {
  documentKey: string;
  instanceId: string;
  chartName?: string;
  label?: string;
  /** TCP port of the requesting editor's frontend. */
  frontendPort?: number;
}

/** Details of the instance that already owns a document. */
export interface OccupancyConflict {
  backendId: string;
  owner: BackendInstance;
}

/**
 * Origin of the local service.
 *
 * Uses the stored server preference only when it is an HTTP(S) loopback URL;
 * otherwise returns `DEFAULT_SERVER_ORIGIN`.
 */
export function serverOrigin(): string {
  // A static web page has no sidecar. Its browser library owns the same
  // asset/URL contract through a synthetic origin.
  if (!isDesktop() && !browserDevPorts()) {
    return BROWSER_LIBRARY_ORIGIN;
  }
  // The browser development server owns the worktree's service port. A stored
  // server preference belongs to the durable desktop profile and must not
  // redirect the development page to a different checkout's service.
  if (browserDevPorts()) {
    return `http://127.0.0.1:${getRuntimePorts().backendPort}`;
  }
  try {
    const stored = preferences.read<unknown>(PREFERENCE_SECTIONS.server, null);
    if (typeof stored === "string") {
      const parsed = new URL(stored);
      const loopback =
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "localhost" ||
        parsed.hostname === "[::1]";
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && loopback) {
        return parsed.origin;
      }
    }
  } catch {
    /* preference store unavailable or not a URL */
  }
  return `http://127.0.0.1:${getRuntimePorts().backendPort}`;
}

/** Encode defined query parameters; empty and nullish values are omitted. */
const query = (values: Record<string, unknown>): string =>
  Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");

/**
 * The stable, range-capable URL for one project asset.
 *
 * Kept outside `LocalLibrary` so a listing can build image URLs without
 * constructing a client or querying the service.
 */
export function projectAssetUrl(origin: string, id: string, name: string): string {
  const cached = cachedProjectAssetUrl(origin, id, name);
  if (cached) {
    return cached;
  }
  if (origin === BROWSER_LIBRARY_ORIGIN) {
    return "";
  }
  const encoded = name
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${origin}/api/projects/${encodeURIComponent(id)}/assets/${encoded}`;
}

/** Project fields the library list can sort by. */
export type LibrarySortField = "created" | "updated" | "name" | "composer" | "charter";
/** Sort direction for a library list request. */
export type LibrarySortDirection = "asc" | "desc";

/** Filters and paging for a project list request. */
export interface ListQuery {
  search?: string;
  group?: string;
  archived?: boolean | string;
  sort?: LibrarySortField;
  direction?: LibrarySortDirection;
  limit?: number;
  offset?: number;
}

/** Mutable project fields accepted by `PATCH /api/projects/{id}`. */
export interface ProjectPatch {
  name?: string;
  group?: string;
  archived?: boolean;
  chart?: unknown;
}

/**
 * Library operations bound to one project id.
 *
 * A scope is the only way to address a project when the caller must not choose
 * an id per request. Every method delegates with the captured id, so an asset
 * commit cannot be retargeted by passing another project at call time.
 */
export interface LibraryProjectScope {
  readonly id: string;
  get(options?: RequestOptions): Promise<{ project: LibraryProject }>;
  update(
    patch: ProjectPatch,
    options?: RequestOptions,
  ): Promise<{ project: LibraryProjectSummary }>;
  remove(options?: RequestOptions): Promise<{ deleted: boolean }>;
  duplicate(name: string, options?: RequestOptions): Promise<{ project: LibraryProjectSummary }>;
  assets(options?: RequestOptions): Promise<{ assets: LibraryAssetSummary[] }>;
  assetUrl(name: string): string;
  asset(name: string, options?: RequestOptions): Promise<Uint8Array>;
  stageAsset(
    name: string,
    bytes: Uint8Array,
    options?: RequestOptions,
  ): Promise<{ asset: LibraryAssetSummary; staged: boolean }>;
  addAsset(
    name: string,
    bytes: Uint8Array,
    options?: RequestOptions,
  ): Promise<{ asset: LibraryAssetSummary; project: LibraryProjectSummary }>;
  removeAsset(
    name: string,
    options?: RequestOptions,
  ): Promise<{ removed: boolean; project: LibraryProjectSummary }>;
  commit(input: LibraryCommitInput, options?: RequestOptions): Promise<LibraryCommitResult>;
  revisions(
    query?: { limit?: number },
    options?: RequestOptions,
  ): Promise<{ revisions: LibraryRevisionSummary[] }>;
  createRevision(
    input: { chart: unknown; label: string },
    options?: RequestOptions,
  ): Promise<{ revision: LibraryRevisionSummary }>;
  revision(revisionId: string, options?: RequestOptions): Promise<{ revision: LibraryRevision }>;
  removeRevision(revisionId: string, options?: RequestOptions): Promise<{ deleted: boolean }>;
}

/** Transport client for one local library service origin. */
export class LocalLibrary {
  readonly origin: string;

  /** Create a client bound to `origin`; defaults to the configured loopback origin. */
  constructor(origin: string = serverOrigin()) {
    this.origin = origin;
  }

  /**
   * Bind one project id and return handles that never accept a different one.
   *
   * The id is validated once here; later calls cannot change the target. The
   * revision methods verify the stored record belongs to this project before
   * returning or deleting it.
   */
  scope(id: string): LibraryProjectScope {
    if (typeof id !== "string" || !id.trim()) {
      throw new RangeError("Library project scope requires a non-empty project id");
    }
    const library = this;
    const requireProjectRevision = async (
      revisionId: string,
      options: RequestOptions = {},
    ): Promise<LibraryRevision> => {
      const { revision } = await library.revision(revisionId, options);
      if (revision.projectId !== id) {
        throw new LocalLibraryError("Revision does not belong to the scoped library project", {
          code: "not_found",
        });
      }
      return revision;
    };
    const view: LibraryProjectScope = {
      id,
      get: (options) => library.get(id, options),
      update: (patch, options) => library.update(id, patch, options),
      remove: (options) => library.remove(id, options),
      duplicate: (name, options) => library.duplicate(id, name, options),
      assets: (options) => library.assets(id, options),
      assetUrl: (name) => library.assetUrl(id, name),
      asset: (name, options) => library.asset(id, name, options),
      stageAsset: (name, bytes, options) => library.stageAsset(id, name, bytes, options),
      addAsset: (name, bytes, options) => library.addAsset(id, name, bytes, options),
      removeAsset: (name, options) => library.removeAsset(id, name, options),
      commit: (input, options) => library.commit(id, input, options),
      revisions: (query, options) => library.revisions(id, query, options),
      createRevision: (input, options) => library.createRevision(id, input, options),
      revision: async (revisionId, options) => ({
        revision: await requireProjectRevision(revisionId, options),
      }),
      removeRevision: async (revisionId, options) => {
        await requireProjectRevision(revisionId, options);
        return library.removeRevision(revisionId, options);
      },
    };
    return Object.freeze(view);
  }

  /** Check that the service answers. */
  health(options: RequestOptions = {}): Promise<{ ok: boolean }> {
    return request(this.origin, "/api/health", options);
  }

  /** Classify dropped paths as a chart, Extension, or note skin, one per path. */
  classifyDropped(
    paths: readonly string[],
    options: RequestOptions = {},
  ): Promise<{ items: DropClassification[] }> {
    return request(this.origin, "/api/intake/classify", {
      ...options,
      method: "POST",
      body: { paths: [...paths] },
    });
  }

  /** Register this editor instance and return the backend id and its record. */
  instancesRegister(
    input: { id: string; label: string; pid?: number; frontendPort?: number },
    options: RequestOptions = {},
  ): Promise<{ backendId: string; instance: BackendInstance }> {
    return request(this.origin, "/api/instances/register", {
      ...options,
      method: "POST",
      body: { ...input, pid: input.pid ?? 0 },
    });
  }

  /** List live instances and the document locks they hold. */
  instancesList(options: RequestOptions = {}): Promise<InstanceList> {
    return request(this.origin, "/api/instances", options);
  }

  /** Refresh this instance's liveness timestamp. */
  instancesHeartbeat(id: string, options: RequestOptions = {}): Promise<{ ok: boolean }> {
    return request(this.origin, "/api/instances/heartbeat", {
      ...options,
      method: "POST",
      body: { id },
    });
  }

  /** Remove an instance on shutdown and return how many remain. */
  instancesLeave(id: string, options: RequestOptions = {}): Promise<{ remaining: number }> {
    return request(this.origin, "/api/instances/leave", {
      ...options,
      method: "POST",
      body: { id },
    });
  }

  /** Clear the document locks held by an instance without unregistering it. */
  instancesClear(id: string, options: RequestOptions = {}): Promise<{ cleared: number }> {
    return request(this.origin, "/api/instances/clear", {
      ...options,
      method: "POST",
      body: { id },
    });
  }

  /** Drop stale instances and return the remaining list. */
  instancesPrune(options: RequestOptions = {}): Promise<InstanceList> {
    return request(this.origin, "/api/instances/prune", {
      ...options,
      method: "POST",
    });
  }

  /** Claim a document for this instance; a taken document fails with status 409. */
  occupancyAcquire(
    input: OccupancyAcquireInput,
    options: RequestOptions = {},
  ): Promise<{ backendId: string; owner: BackendInstance }> {
    return request(this.origin, "/api/occupancy/acquire", {
      ...options,
      method: "POST",
      body: input,
    });
  }

  /** Release this instance's claim on a document. */
  occupancyRelease(
    input: { documentKey: string; instanceId: string },
    options: RequestOptions = {},
  ): Promise<{ released: boolean }> {
    return request(this.origin, "/api/occupancy/release", {
      ...options,
      method: "POST",
      body: input,
    });
  }

  /** Drop the backend-held occupancy for a document regardless of owner. */
  occupancyClearBackend(
    documentKey: string,
    options: RequestOptions = {},
  ): Promise<{ cleared: boolean }> {
    return request(this.origin, "/api/occupancy/clear-backend", {
      ...options,
      method: "POST",
      body: { documentKey },
    });
  }

  /** Report whether this instance may keep a document claim and who owns it. */
  occupancyReconcile(
    input: { documentKey: string; instanceId: string },
    options: RequestOptions = {},
  ): Promise<{ backendId: string; available: boolean; owner: BackendInstance }> {
    return request(this.origin, "/api/occupancy/reconcile", {
      ...options,
      method: "POST",
      body: input,
    });
  }

  /** List project summaries with search, grouping, sorting and paging. */
  list(
    { search, group, archived, sort, direction, limit, offset }: ListQuery = {},
    options: RequestOptions = {},
  ): Promise<{ projects: LibraryProjectSummary[]; total: number }> {
    const search$ = query({ search, group, archived, sort, direction, limit, offset });
    return request(this.origin, `/api/projects${search$ ? `?${search$}` : ""}`, options);
  }

  /** Load one project including its chart. */
  get(id: string, options: RequestOptions = {}): Promise<{ project: LibraryProject }> {
    return request(this.origin, `/api/projects/${encodeURIComponent(id)}`, options);
  }

  /** Load project metadata without the chart payload. */
  summary(id: string, options: RequestOptions = {}): Promise<{ project: LibraryProjectSummary }> {
    return request(this.origin, `/api/projects/${encodeURIComponent(id)}/summary`, options);
  }

  /**
   * Stream one project's chart frames.
   *
   * The caller decodes the frame protocol; this method only owns the HTTP
   * transport and the response body lifetime.
   */
  async *chartStream(
    id: string,
    options: RequestOptions & { includeLines?: boolean } = {},
  ): AsyncIterable<Uint8Array> {
    const signal =
      options.timeoutMs && typeof globalThis.AbortSignal?.timeout === "function"
        ? AbortSignal.timeout(options.timeoutMs)
        : undefined;
    const includeLines = options.includeLines === false ? "?includeLines=false" : "";
    let response: Response;
    try {
      response = await fetch(
        `${this.origin}/api/projects/${encodeURIComponent(id)}/chart/stream${includeLines}`,
        {
          signal,
          headers: options.headers,
        },
      );
    } catch (error) {
      throw new LocalLibraryError(
        t("system.library.unreachable", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    if (!response.ok) {
      throw new LocalLibraryError(t("system.library.requestFailed", { status: response.status }), {
        status: response.status,
        code: "chart_stream",
      });
    }
    if (!response.body) {
      throw new LocalLibraryError(t("system.library.requestFailed", { status: response.status }), {
        status: response.status,
        code: "chart_stream",
      });
    }
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value?.length) {
          yield value;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Read one bounded line batch as a decoded frame.
   *
   * The service verifies the requested range against its cached index and
   * returns one `lines` frame containing the raw JSON array text.
   */
  async chartLines(
    id: string,
    start: number,
    count: number,
    options: RequestOptions = {},
  ): Promise<{ start: number; count: number; raw: string }> {
    const signal =
      options.timeoutMs && typeof globalThis.AbortSignal?.timeout === "function"
        ? AbortSignal.timeout(options.timeoutMs)
        : undefined;
    const query = new URLSearchParams({ start: String(start), count: String(count) });
    let response: Response;
    try {
      response = await fetch(
        `${this.origin}/api/projects/${encodeURIComponent(id)}/chart/lines?${query}`,
        { signal, headers: options.headers },
      );
    } catch (error) {
      throw new LocalLibraryError(
        t("system.library.unreachable", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    if (!response.ok) {
      throw new LocalLibraryError(t("system.library.requestFailed", { status: response.status }), {
        status: response.status,
        code: "chart_lines",
      });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const frame = new ChartFrameDecoder()
      .push(bytes)
      .find((entry) => entry.kind === CHART_FRAME.lines);
    if (!frame) {
      throw new LocalLibraryError(t("system.library.requestFailed", { status: response.status }), {
        status: response.status,
        code: "chart_lines",
      });
    }
    return decodeLinesFrame(frame);
  }

  /** Create a project from a parsed chart. */
  create(
    { name, group, chart }: { name: string; group?: string; chart: unknown },
    options: RequestOptions = {},
  ): Promise<{ project: LibraryProjectSummary }> {
    return request(this.origin, "/api/projects", {
      ...options,
      method: "POST",
      body: { name, group, chart },
    });
  }

  /** Create a project from chart text that is already serialized. */
  createRaw(
    { name, group, chartJson }: { name: string; group?: string; chartJson: string },
    options: RequestOptions = {},
  ): Promise<{ project: LibraryProjectSummary }> {
    return request(this.origin, "/api/projects", {
      ...options,
      method: "POST",
      bodyText: `{"name":${JSON.stringify(name)},"group":${JSON.stringify(group ?? "")},"chart":${chartJson}}`,
    });
  }

  /** Patch a project's metadata or chart. */
  update(
    id: string,
    patch: ProjectPatch,
    options: RequestOptions = {},
  ): Promise<{ project: LibraryProjectSummary }> {
    return request(this.origin, `/api/projects/${encodeURIComponent(id)}`, {
      ...options,
      method: "PATCH",
      body: patch,
    });
  }

  /** Delete a project, its revisions, and its asset references. */
  remove(id: string, options: RequestOptions = {}): Promise<{ deleted: boolean }> {
    return request(this.origin, `/api/projects/${encodeURIComponent(id)}`, {
      ...options,
      method: "DELETE",
    });
  }

  /** Copy a project under a new name. */
  duplicate(
    id: string,
    name: string,
    options: RequestOptions = {},
  ): Promise<{ project: LibraryProjectSummary }> {
    return request(this.origin, `/api/projects/${encodeURIComponent(id)}/duplicate`, {
      ...options,
      method: "POST",
      body: { name },
      timeoutMs: options.timeoutMs ?? 15_000,
    });
  }

  /** List the asset manifest of a project without loading its bytes. */
  assets(id: string, options: RequestOptions = {}): Promise<{ assets: LibraryAssetSummary[] }> {
    return request(this.origin, `/api/projects/${encodeURIComponent(id)}/assets`, options);
  }

  /** The stable, range-capable URL for one project asset. */
  assetUrl(id: string, name: string): string {
    return projectAssetUrl(this.origin, id, name);
  }

  /** Read one project asset as bytes without listing the whole manifest. */
  async asset(id: string, name: string, options: RequestOptions = {}): Promise<Uint8Array> {
    const signal =
      typeof globalThis.AbortSignal?.timeout === "function"
        ? AbortSignal.timeout(options.timeoutMs ?? 60_000)
        : undefined;
    const response = await fetch(this.assetUrl(id, name), {
      signal,
      headers: { "x-redux-client": "1" },
    });
    if (!response.ok) {
      throw new LocalLibraryError(t("system.library.requestFailed", { status: response.status }), {
        status: response.status,
        code: "asset_request_failed",
      });
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  /** Upload one blob to the content-addressed store without attaching it. */
  async stageAsset(
    id: string,
    name: string,
    bytes: Uint8Array,
    options: RequestOptions = {},
  ): Promise<{ asset: LibraryAssetSummary; staged: boolean }> {
    const path = `/api/projects/${encodeURIComponent(id)}/assets?name=${encodeURIComponent(name)}`;
    const trace = beginBackendTrace("POST", path);
    const signal =
      typeof globalThis.AbortSignal?.timeout === "function"
        ? AbortSignal.timeout(options.timeoutMs ?? 60_000)
        : undefined;
    let response: Response;
    try {
      response = await fetch(`${this.origin}${path}`, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/octet-stream",
          "x-redux-client": "1",
        },
        body: bytes.slice().buffer as ArrayBuffer,
      });
    } catch (error) {
      trace.finish({ status: null, outcome: "error", errorCode: "transport" });
      throw new LocalLibraryError(
        t("system.library.unreachable", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    const text = await response.text();
    let payload: {
      error?: { message?: string; code?: string; details?: unknown };
    } & Record<string, unknown>;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      trace.finish({ status: response.status, outcome: "error", errorCode: "bad_response" });
      throw new LocalLibraryError(
        t("system.library.nonJsonResponse", { status: response.status }),
        {
          status: response.status,
          code: "bad_response",
        },
      );
    }
    if (!response.ok) {
      const code = payload?.error?.code ?? "http_error";
      trace.finish({ status: response.status, outcome: "error", errorCode: code });
      throw new LocalLibraryError(
        payload?.error?.message ?? t("system.library.requestFailed", { status: response.status }),
        { status: response.status, code },
      );
    }
    trace.finish({ status: response.status, outcome: "success" });
    return payload as { asset: LibraryAssetSummary; staged: boolean };
  }

  /**
   * Upload and attach one project asset, committing the library copy.
   *
   * The project's stored chart is unchanged; callers should save open editor
   * state before using this on a document with unsaved edits.
   */
  async addAsset(
    id: string,
    name: string,
    bytes: Uint8Array,
    options: RequestOptions = {},
  ): Promise<{ asset: LibraryAssetSummary; project: LibraryProjectSummary }> {
    const staged = await this.stageAsset(id, name, bytes, options);
    const { project } = await this.get(id, options);
    const { assets } = await this.assets(id, options);
    const manifest = [
      ...assets
        .filter((asset) => asset.name !== name)
        .map(({ name: entry, hash }) => ({
          name: entry,
          hash,
        })),
      { name: staged.asset.name, hash: staged.asset.hash },
    ];
    await this.commit(
      id,
      {
        baseRevision: project.revision,
        name: project.name,
        chartJson: JSON.stringify(project.chart),
        assets: manifest,
        ...(project.viewState ? { viewState: project.viewState } : {}),
        ...(project.assetFolders ? { assetFolders: project.assetFolders } : {}),
        label: `Add asset ${name}`,
      },
      options,
    );
    return { asset: staged.asset, project };
  }

  /**
   * Remove one project asset from the manifest and commit the library copy.
   *
   * The project's stored chart is unchanged. A chart reference to the removed
   * name is left as written, so update the metadata or line texture first when
   * the asset is still in use.
   */
  async removeAsset(
    id: string,
    name: string,
    options: RequestOptions = {},
  ): Promise<{ removed: boolean; project: LibraryProjectSummary }> {
    const { project } = await this.get(id, options);
    const { assets } = await this.assets(id, options);
    const manifest = assets
      .filter((asset) => asset.name !== name)
      .map(({ name: entry, hash }) => ({ name: entry, hash }));
    if (manifest.length === assets.length) {
      return { removed: false, project };
    }
    await this.commit(
      id,
      {
        baseRevision: project.revision,
        name: project.name,
        chartJson: JSON.stringify(project.chart),
        assets: manifest,
        ...(project.viewState ? { viewState: project.viewState } : {}),
        ...(project.assetFolders ? { assetFolders: project.assetFolders } : {}),
        label: `Remove asset ${name}`,
      },
      options,
    );
    return { removed: true, project };
  }

  /**
   * Commit a chart and its complete asset manifest atomically.
   *
   * The chart is inserted as raw text: serializing it once in the renderer's
   * worker and then `JSON.stringify`-ing the envelope would marshal the largest
   * value twice on the interaction thread.
   */
  commit(
    id: string,
    input: LibraryCommitInput,
    options: RequestOptions = {},
  ): Promise<LibraryCommitResult> {
    const fields: string[] = [];
    if (input.baseRevision !== undefined) {
      fields.push(`"baseRevision":${JSON.stringify(input.baseRevision)}`);
    }
    if (input.name !== undefined) {
      fields.push(`"name":${JSON.stringify(input.name)}`);
    }
    fields.push(`"chart":${input.chartJson}`);
    fields.push(`"assets":${JSON.stringify(input.assets)}`);
    if (input.viewState !== undefined) {
      fields.push(`"viewState":${JSON.stringify(input.viewState)}`);
    }
    if (input.assetFolders !== undefined) {
      fields.push(`"assetFolders":${JSON.stringify(input.assetFolders)}`);
    }
    if (input.label !== undefined) {
      fields.push(`"label":${JSON.stringify(input.label)}`);
    }
    if (input.snapshot !== undefined) {
      fields.push(`"snapshot":${JSON.stringify(input.snapshot)}`);
    }
    return request(this.origin, `/api/projects/${encodeURIComponent(id)}/commit`, {
      ...options,
      method: "POST",
      bodyText: `{${fields.join(",")}}`,
      timeoutMs: options.timeoutMs ?? 30_000,
    });
  }

  /**
   * Commit a chart from a chunk stream.
   *
   * The begin request carries only metadata; chart text arrives as raw PUT
   * chunks, so a chart larger than the 64 MiB JSON body cap still commits.
   */
  async commitStream(
    id: string,
    input: Omit<LibraryCommitInput, "chartJson">,
    chunks: AsyncIterable<string>,
    options: RequestOptions = {},
  ): Promise<LibraryCommitResult> {
    const begin = await request<{ sessionId: string }>(
      this.origin,
      `/api/projects/${encodeURIComponent(id)}/commit/begin`,
      {
        ...options,
        method: "POST",
        body: {
          ...(input.baseRevision !== undefined ? { baseRevision: input.baseRevision } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          assets: input.assets,
          ...(input.viewState !== undefined ? { viewState: input.viewState } : {}),
          ...(input.assetFolders !== undefined ? { assetFolders: input.assetFolders } : {}),
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.snapshot !== undefined ? { snapshot: input.snapshot } : {}),
        },
        timeoutMs: 30_000,
      },
    );
    const sessionPath = `/api/projects/${encodeURIComponent(id)}/commit/${encodeURIComponent(
      begin.sessionId,
    )}/chart`;
    for await (const chunk of chunks) {
      const response = await fetch(`${this.origin}${sessionPath}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream", "x-redux-client": "1" },
        body: chunk,
      });
      if (!response.ok) {
        let message = t("system.library.requestFailed", { status: response.status });
        try {
          const payload = (await response.json()) as { error?: { message?: string } };
          message = payload.error?.message ?? message;
        } catch {
          // Keep the status-based message when the body is not JSON.
        }
        throw new LocalLibraryError(message, { status: response.status, code: "commit_chunk" });
      }
    }
    return request<LibraryCommitResult>(
      this.origin,
      `/api/projects/${encodeURIComponent(id)}/commit/${encodeURIComponent(
        begin.sessionId,
      )}/finish`,
      {
        ...options,
        method: "POST",
        timeoutMs: options.timeoutMs ?? 300_000,
      },
    );
  }

  /** List stored revisions, newest first. */
  revisions(
    id: string,
    { limit }: { limit?: number } = {},
    options: RequestOptions = {},
  ): Promise<{ revisions: LibraryRevisionSummary[] }> {
    const search$ = query({ limit });
    return request(
      this.origin,
      `/api/projects/${encodeURIComponent(id)}/revisions${search$ ? `?${search$}` : ""}`,
      options,
    );
  }

  /** Store a labeled revision of a chart. */
  createRevision(
    id: string,
    { chart, label }: { chart: unknown; label: string },
    options: RequestOptions = {},
  ): Promise<{ revision: LibraryRevisionSummary }> {
    return request(this.origin, `/api/projects/${encodeURIComponent(id)}/revisions`, {
      ...options,
      method: "POST",
      body: { chart, label },
    });
  }

  /** Load one revision including its chart. */
  revision(id: string, options: RequestOptions = {}): Promise<{ revision: LibraryRevision }> {
    return request(this.origin, `/api/revisions/${encodeURIComponent(id)}`, options);
  }

  /** Delete one stored revision. */
  removeRevision(id: string, options: RequestOptions = {}): Promise<{ deleted: boolean }> {
    return request(this.origin, `/api/revisions/${encodeURIComponent(id)}`, {
      ...options,
      method: "DELETE",
    });
  }

  /** Read the preference values stored by the service. */
  preferences(options: RequestOptions = {}): Promise<{ values: Record<string, unknown> }> {
    return request(this.origin, "/api/preferences", options);
  }

  /** Ask the service to checkpoint its SQLite database. */
  checkpoint(options: RequestOptions = {}): Promise<{ ok: boolean }> {
    return request(this.origin, "/api/maintenance/checkpoint", {
      ...options,
      method: "POST",
    });
  }

  /** Read the automatic snapshot store state. */
  backupStatus(options: RequestOptions = {}): Promise<LibraryBackupStatus> {
    return request(this.origin, "/api/library/backups/status", options);
  }

  /** Write one snapshot immediately. */
  backupSnapshot(reason = "manual", options: RequestOptions = {}): Promise<LibraryBackupSummary> {
    return request(this.origin, "/api/library/backups/snapshots", {
      ...options,
      method: "POST",
      body: { reason },
    });
  }

  /** List recent snapshots, newest first. */
  backupHistory(
    { limit = 50 }: { limit?: number } = {},
    options: RequestOptions = {},
  ): Promise<{ commits: LibraryBackupSummary[] }> {
    const search = new URLSearchParams({ limit: String(limit) });
    return request(this.origin, `/api/library/backups/commits?${search.toString()}`, options);
  }

  /** Restore the newest snapshot, or one explicit commit. */
  backupRestore(commitId = "", options: RequestOptions = {}): Promise<LibraryBackupSummary> {
    return request(this.origin, "/api/library/backups/restore", {
      ...options,
      method: "POST",
      body: { commitId },
    });
  }

  /** Verify every object reachable from one snapshot, or HEAD. */
  backupVerify(commitId = "", options: RequestOptions = {}): Promise<LibraryBackupVerifyReport> {
    return request(this.origin, "/api/library/backups/verify", {
      ...options,
      method: "POST",
      body: { commitId },
    });
  }

  /** Prune history and unreachable objects. */
  backupCompact(keep = 0, options: RequestOptions = {}): Promise<LibraryBackupCompactReport> {
    return request(this.origin, "/api/library/backups/compact", {
      ...options,
      method: "POST",
      body: { keep },
    });
  }

  /** Replace the preference values stored by the service. */
  savePreferences(
    values: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<{ values: Record<string, unknown> }> {
    return request(this.origin, "/api/preferences", {
      ...options,
      method: "PUT",
      body: { values },
    });
  }
}

/** A reachable service client and the health response that confirmed it. */
export interface DetectedLibrary {
  library: LocalLibrary;
  health: { ok: boolean };
}

/**
 * Return a client only when the service answers.
 *
 * An unreachable service yields `null`, so callers treat "offline" as a state
 * rather than a transport error.
 */
export async function detectLocalLibrary({
  origin = serverOrigin(),
  timeoutMs = 600,
}: { origin?: string; timeoutMs?: number } = {}): Promise<DetectedLibrary | null> {
  const library = new LocalLibrary(origin);
  try {
    const health = await library.health({ timeoutMs });
    if (health?.ok !== true) {
      return null;
    }
    return { library, health };
  } catch {
    return null;
  }
}
