/**
 * Owns the chart library handle a plugin sees.
 *
 * A project is one stored chart: `create` writes a new one into the library,
 * `list` returns the summaries the home page draws as cards, and one project's
 * reads and writes live on the handle returned by `scope(id)` or `current`.
 * The library is the editor's source of truth; JSON and PEZ files are import
 * containers, and PEZ is the export container.
 *
 * Every method probes the local service on demand and returns the shared result
 * envelope. Creating a chart, opening one into the editor, and saving a
 * document stay editor operations; this handle only reads and writes the
 * library.
 *
 * Minimal usage:
 * ```js
 * const listed = await redux.library.list({ limit: 5 });
 * if (listed.ok) {
 *   const project = redux.library.scope(listed.value.projects[0].id);
 *   const read = await project.get();
 * }
 * ```
 */
import { t } from "../../i18n/index.ts";
import { editorProjectId } from "../edit/state/publishedValues.ts";
import type { LibraryProjectScope, LocalLibrary } from "../global/library/client.ts";
import { localService, localServiceStatus } from "../global/library/service.ts";
import { apiCallAsync, availabilityFor, unavailableResult } from "./support.ts";
import type { ApiAvailability, ApiResult } from "./contract.ts";

/** Run one library operation against the connected local service. */
async function libraryCall<T>(
  run: (library: LocalLibrary) => T | Promise<T>,
): Promise<ApiResult<T>> {
  const service = await localService();
  if (!service) {
    return unavailableResult<T>(t("system.library.notRunning"));
  }
  return apiCallAsync(async () => run(service.library));
}

/** One project's library handle; every method omits the project id. */
export interface LibraryProjectHandle {
  readonly id: string;
  get(
    options?: Parameters<LocalLibrary["get"]>[1],
  ): Promise<ApiResult<Awaited<ReturnType<LocalLibrary["get"]>>>>;
  update(
    patch: Parameters<LocalLibrary["update"]>[1],
    options?: Parameters<LocalLibrary["update"]>[2],
  ): Promise<ApiResult<Awaited<ReturnType<LocalLibrary["update"]>>>>;
  remove(
    options?: Parameters<LocalLibrary["remove"]>[1],
  ): Promise<ApiResult<Awaited<ReturnType<LocalLibrary["remove"]>>>>;
  duplicate(
    name: Parameters<LocalLibrary["duplicate"]>[1],
    options?: Parameters<LocalLibrary["duplicate"]>[2],
  ): Promise<ApiResult<Awaited<ReturnType<LocalLibrary["duplicate"]>>>>;
  assets(
    options?: Parameters<LocalLibrary["assets"]>[1],
  ): Promise<ApiResult<Awaited<ReturnType<LocalLibrary["assets"]>>>>;
  asset(
    name: Parameters<LocalLibrary["asset"]>[1],
    options?: Parameters<LocalLibrary["asset"]>[2],
  ): Promise<ApiResult<Awaited<ReturnType<LocalLibrary["asset"]>>>>;
  addAsset(
    name: Parameters<LocalLibrary["addAsset"]>[1],
    bytes: Parameters<LocalLibrary["addAsset"]>[2],
    options?: Parameters<LocalLibrary["addAsset"]>[3],
  ): Promise<ApiResult<Awaited<ReturnType<LocalLibrary["addAsset"]>>>>;
  removeAsset(
    name: Parameters<LocalLibrary["removeAsset"]>[1],
    options?: Parameters<LocalLibrary["removeAsset"]>[2],
  ): Promise<ApiResult<Awaited<ReturnType<LocalLibrary["removeAsset"]>>>>;
  revisions(
    query?: Parameters<LocalLibrary["revisions"]>[1],
    options?: Parameters<LocalLibrary["revisions"]>[2],
  ): Promise<ApiResult<Awaited<ReturnType<LocalLibrary["revisions"]>>>>;
  createRevision(
    input: Parameters<LocalLibrary["createRevision"]>[1],
    options?: Parameters<LocalLibrary["createRevision"]>[2],
  ): Promise<ApiResult<Awaited<ReturnType<LocalLibrary["createRevision"]>>>>;
  revision(
    revisionId: Parameters<LocalLibrary["revision"]>[0],
    options?: Parameters<LocalLibrary["revision"]>[1],
  ): Promise<ApiResult<Awaited<ReturnType<LocalLibrary["revision"]>>>>;
  removeRevision(
    revisionId: Parameters<LocalLibrary["removeRevision"]>[0],
    options?: Parameters<LocalLibrary["removeRevision"]>[1],
  ): Promise<ApiResult<Awaited<ReturnType<LocalLibrary["removeRevision"]>>>>;
}

/** Build a lazy handle whose operations always target `id`. */
export function libraryProject(id: string): LibraryProjectHandle {
  if (typeof id !== "string" || !id.trim()) {
    throw new RangeError("Library project scope requires a non-empty project id");
  }
  const call = <T>(run: (project: LibraryProjectScope) => T | Promise<T>): Promise<ApiResult<T>> =>
    libraryCall((service) => run(service.scope(id)));
  const handle: LibraryProjectHandle = {
    id,
    get: (options) => call((project) => project.get(options)),
    update: (patch, options) => call((project) => project.update(patch, options)),
    remove: (options) => call((project) => project.remove(options)),
    duplicate: (name, options) => call((project) => project.duplicate(name, options)),
    assets: (options) => call((project) => project.assets(options)),
    asset: (name, options) => call((project) => project.asset(name, options)),
    addAsset: (name, bytes, options) => call((project) => project.addAsset(name, bytes, options)),
    removeAsset: (name, options) => call((project) => project.removeAsset(name, options)),
    revisions: (query, options) => call((project) => project.revisions(query, options)),
    createRevision: (input, options) => call((project) => project.createRevision(input, options)),
    revision: (revisionId, options) => call((project) => project.revision(revisionId, options)),
    removeRevision: (revisionId, options) =>
      call((project) => project.removeRevision(revisionId, options)),
  };
  return Object.freeze(handle);
}

/** Stored chart projects and their assets exposed to plugins. */
export const library = Object.freeze({
  /** Report whether the local library service is reachable. */
  availability(): ApiAvailability {
    if (localServiceStatus() === "unknown") {
      void localService();
    }
    return availabilityFor(localServiceStatus() === "available", t("system.library.notRunning"));
  },
  /** List project summaries, paged and filtered by the supplied query. */
  list: (...args: Parameters<LocalLibrary["list"]>) =>
    libraryCall((library) => library.list(...args)),
  /** Create a project from a chart value. */
  create: (...args: Parameters<LocalLibrary["create"]>) =>
    libraryCall((library) => library.create(...args)),
  /** Create a project from already serialized chart text. */
  createRaw: (...args: Parameters<LocalLibrary["createRaw"]>) =>
    libraryCall((library) => library.createRaw(...args)),
  /**
   * Bind one project id and return a handle whose methods no longer take an id.
   *
   * The scope resolves the service lazily on every call, like the root handle.
   */
  scope(id: string): LibraryProjectHandle {
    return libraryProject(id);
  },
  /** Handle bound to the library project behind the open document. */
  get current(): LibraryProjectHandle {
    return libraryProject(editorProjectId.get());
  },
});

export type LibraryHandle = typeof library;

export type {
  LibraryAssetSummary,
  LibraryBackupCompactReport,
  LibraryBackupPolicy,
  LibraryBackupStatus,
  LibraryBackupSummary,
  LibraryBackupVerifyReport,
  LibraryProject,
  LibraryProjectSummary,
  LibraryRevision,
  LibraryRevisionSummary,
  ListQuery,
  LocalLibraryError,
  ProjectPatch,
  RequestOptions,
} from "../global/library/client.ts";
