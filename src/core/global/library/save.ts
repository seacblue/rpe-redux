/**
 * Persists a document into the SQLite library.
 *
 * Assets are staged only when their bytes changed, then one commit replaces the
 * chart and the complete manifest. The library is the source of truth; writing
 * a file is a separate, explicit export.
 */
import type { AssetMap } from "../document/types.ts";
import { assetNames, assetPath, snapshotAssets } from "../document/resources.ts";
import { captureLibraryAssets } from "./document.ts";
import {
  generateLibraryThumbnail,
  isLibraryImageAsset,
  LIBRARY_THUMBNAIL_ASSET,
} from "../../media/thumbnail.ts";
import type { LibraryCommitResult, LocalLibrary } from "./client.ts";
import type { LibraryViewState } from "./types.ts";
import { throwIfAborted } from "../../utils/abort.ts";

/** Input for one library save. */
export interface LibrarySaveInput {
  library: LocalLibrary;
  projectId?: string;
  baseRevision?: number;
  chart: unknown;
  chartJson: string;
  /** Chunked chart text; when present, the save uses the streamed commit. */
  chartChunks?: AsyncIterable<string>;
  name: string;
  group?: string;
  assets: AssetMap;
  viewState?: LibraryViewState;
  assetFolders?: readonly string[];
  /** Active charting seconds since the previous save; added to the total. */
  editSeconds?: number;
  /** Create a new project for this save and leave the source project unchanged. */
  duplicate?: boolean;
  /** Project name for the copy; defaults to `name`. */
  duplicateName?: string;
  onProgress?: (value: number) => void;
  /** Cooperatively cancel between library requests. */
  signal?: AbortSignal;
}

/** Outcome of a library save, including the committed manifest. */
export interface LibrarySaveResult {
  projectId: string;
  revision: number;
  created: boolean;
  name: string;
  /** Hashes now attached to the project, so the caller can cache them. */
  manifest: readonly { name: string; hash: string }[];
  committed: LibraryCommitResult["project"];
}

/** Read the chart's declared cover without coupling this save boundary to a chart type. */
function chartBackground(chart: unknown): string {
  if (!chart || typeof chart !== "object") {
    return "";
  }
  const value = (chart as { META?: { background?: unknown } }).META?.background;
  return typeof value === "string" ? value.trim() : "";
}

/** Make a save snapshot whose lazy name set includes a generated thumbnail. */
function saveAssetSnapshot(assets: AssetMap): AssetMap {
  const snapshot = snapshotAssets(assets);
  const names = new Set(assetNames(assets));
  snapshot.names = () => names;
  return snapshot;
}

/** Generate or remove the bounded cover used by welcome-page previews. */
async function prepareLibraryAssets(input: LibrarySaveInput): Promise<AssetMap> {
  const assets = input.assets;
  const names = [...assetNames(assets)];
  const hasThumbnail = names.includes(LIBRARY_THUMBNAIL_ASSET);
  const declared = chartBackground(input.chart);
  const background = declared
    ? assetPath(assets, declared, input.name)
    : (names.find((name) => name !== LIBRARY_THUMBNAIL_ASSET && isLibraryImageAsset(name)) ?? null);
  if (!background) {
    if (!hasThumbnail) {
      return assets;
    }
    assets.delete(LIBRARY_THUMBNAIL_ASSET);
    return saveAssetSnapshot(assets);
  }
  const bytes = assets.get(background) ?? (await assets.read?.(background)) ?? null;
  if (!bytes) {
    return assets;
  }
  const metadata = assets as AssetMap & {
    original?: Map<string, Uint8Array>;
  };
  const backgroundUnchanged =
    hasThumbnail &&
    metadata.original?.has(background) === true &&
    metadata.original.get(background) === bytes;
  if (backgroundUnchanged) {
    return assets;
  }
  const thumbnail = await generateLibraryThumbnail(bytes);
  if (!thumbnail) {
    return assets;
  }
  assets.set(LIBRARY_THUMBNAIL_ASSET, thumbnail);
  const snapshot = saveAssetSnapshot(assets);
  const snapshotNames = new Set(assetNames(snapshot));
  snapshotNames.add(LIBRARY_THUMBNAIL_ASSET);
  snapshot.names = () => snapshotNames;
  return snapshot;
}

/**
 * Save a chart snapshot into the library.
 *
 * `chartJson` is used for both the first create and the commit so a large chart
 * is serialized once, in the caller's worker, rather than once per request.
 */
export async function saveLibraryDocument(input: LibrarySaveInput): Promise<LibrarySaveResult> {
  const progress = input.onProgress ?? (() => {});
  let projectId = input.projectId;
  let revision = input.baseRevision;
  let created = false;
  let cleanupProjectId = "";
  const copyName = input.duplicateName ?? input.name;

  try {
    throwIfAborted(input.signal);
    if (projectId && input.duplicate) {
      const copy = await input.library.duplicate(projectId, copyName);
      throwIfAborted(input.signal);
      projectId = copy.project.id;
      revision = copy.project.revision;
      created = true;
      cleanupProjectId = projectId;
    } else if (!projectId) {
      const project = await input.library.createRaw(
        {
          name: input.duplicate ? copyName : input.name,
          group: input.group,
          chartJson: input.chartChunks ? "{}" : input.chartJson,
        },
        { timeoutMs: 30_000 },
      );
      throwIfAborted(input.signal);
      projectId = project.project.id;
      revision = project.project.revision;
      created = true;
      cleanupProjectId = projectId;
    }
    if (!projectId) {
      throw new Error("library save did not produce a project id");
    }
    progress(0.1);

    const preparedAssets = await prepareLibraryAssets(input);
    throwIfAborted(input.signal);
    const capture = await captureLibraryAssets(preparedAssets);
    throwIfAborted(input.signal);
    const manifest = [...capture.manifest];
    const total = Math.max(1, capture.uploads.length);
    for (const [index, upload] of capture.uploads.entries()) {
      const staged = await input.library.stageAsset(projectId, upload.name, upload.bytes);
      throwIfAborted(input.signal);
      manifest.push({ name: staged.asset.name, hash: staged.asset.hash });
      progress(0.1 + ((index + 1) / total) * 0.55);
    }
    manifest.sort((left, right) => left.name.localeCompare(right.name));
    progress(0.7);

    const commitInput = {
      baseRevision: revision,
      ...(input.duplicate ? {} : { name: input.name }),
      assets: manifest,
      ...(input.viewState ? { viewState: input.viewState } : {}),
      ...(input.assetFolders ? { assetFolders: input.assetFolders } : {}),
      ...(input.editSeconds ? { editSeconds: input.editSeconds } : {}),
    };
    const result = input.chartChunks
      ? await input.library.commitStream(projectId, commitInput, input.chartChunks)
      : await input.library.commit(projectId, { ...commitInput, chartJson: input.chartJson });
    cleanupProjectId = "";
    progress(1);
    return {
      projectId,
      revision: result.project.revision,
      created,
      name: input.duplicate ? copyName : input.name,
      manifest,
      committed: result.project,
    };
  } catch (error) {
    // A failed first save must not leave a partial project behind, especially
    // when disk pressure interrupted asset staging or the commit.
    if (cleanupProjectId) {
      await input.library.remove(cleanupProjectId).catch(() => undefined);
    }
    throw error;
  }
}
