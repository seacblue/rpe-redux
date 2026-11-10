/**
 * Persists a document into the SQLite library.
 *
 * Assets are staged only when their bytes changed, then one commit replaces the
 * chart and the complete manifest. The library is the source of truth; writing
 * a file is a separate, explicit export.
 */
import type { AssetMap } from "../document/types.ts";
import { captureLibraryAssets } from "./document.ts";
import type { LibraryCommitResult, LocalLibrary } from "./client.ts";
import type { LibraryViewState } from "./types.ts";

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
  /** Create a new project for this save and leave the source project unchanged. */
  duplicate?: boolean;
  /** Project name for the copy; defaults to `name`. */
  duplicateName?: string;
  onProgress?: (value: number) => void;
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
    if (projectId && input.duplicate) {
      const copy = await input.library.duplicate(projectId, copyName);
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
      projectId = project.project.id;
      revision = project.project.revision;
      created = true;
      cleanupProjectId = projectId;
    }
    if (!projectId) {
      throw new Error("library save did not produce a project id");
    }
    progress(0.1);

    const capture = await captureLibraryAssets(input.assets);
    const manifest = [...capture.manifest];
    const total = Math.max(1, capture.uploads.length);
    for (const [index, upload] of capture.uploads.entries()) {
      const staged = await input.library.stageAsset(projectId, upload.name, upload.bytes);
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
