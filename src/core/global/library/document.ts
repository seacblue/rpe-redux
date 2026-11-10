/**
 * Opens library projects as editor documents and captures the asset manifest a
 * save needs.
 *
 * The bytes stay in the SQLite asset table. This module gives the renderer a
 * lazy `AssetMap` backed by the service's range-capable URLs, and turns a live
 * map into "known hashes" plus "only the bytes that changed". Chart rules and
 * transport stay in their own modules.
 */
import type { AssetMap } from "../document/types.ts";
import { assetNames } from "../document/resources.ts";
import { parseChartByteStream } from "../chart/streaming/chartFrameParser.ts";
import { scanJsonArrayRanges } from "../chart/streaming/chartJsonScanner.ts";
import type { ChartDocument } from "../chart/streaming/chartDocument.ts";
import {
  PAGED_DOCUMENT_MAX_BYTES,
  PAGED_DOCUMENT_MAX_LINES,
  type ChartLineProvider,
} from "../chart/streaming/chartStreamTypes.ts";
import type {
  LibraryAssetSummary,
  LibraryProject,
  LibraryProjectSummary,
  LocalLibrary,
} from "./client.ts";

/** A lazy asset map that remembers which content hash each name already has. */
export interface LibraryAssetMap extends AssetMap {
  /** Last known content hash per asset name, from the service manifest. */
  hashes: Map<string, string>;
  /** Byte instances loaded from the service, used to detect local edits. */
  original: Map<string, Uint8Array>;
  /** Fetch and cache the bytes of every name matching `pattern`. */
  materialize(pattern?: RegExp): Promise<void>;
}

/** A loaded project together with the lazy asset map for its manifest. */
export interface OpenedLibraryProject {
  project: LibraryProject;
  assets: LibraryAssetMap;
}

/**
 * Build a lazy map over the project's asset manifest.
 *
 * Names and hashes are known immediately; bytes are fetched through the
 * service's range-capable URL on first read and cached in the map.
 */
export function createLibraryAssetMap(
  library: LocalLibrary,
  projectId: string,
  manifest: readonly LibraryAssetSummary[],
): LibraryAssetMap {
  const assets = new Map<string, Uint8Array>() as LibraryAssetMap;
  const names = new Set(manifest.map((asset) => asset.name));
  assets.hashes = new Map(manifest.map((asset) => [asset.name, asset.hash]));
  assets.original = new Map();
  assets.names = () => names;
  // Keep `names()` complete by mirroring every map mutation into the name set.
  const set = assets.set.bind(assets);
  assets.set = (name, bytes) => {
    names.add(name);
    return set(name, bytes);
  };
  const remove = assets.delete.bind(assets);
  assets.delete = (name) => {
    names.delete(name);
    return remove(name);
  };
  const clear = assets.clear.bind(assets);
  assets.clear = () => {
    names.clear();
    clear();
  };
  assets.uri = (name) => library.assetUrl(projectId, name);
  assets.read = async (name) => {
    const cached = assets.get(name);
    if (cached) {
      return cached;
    }
    let response: Response;
    try {
      response = await fetch(library.assetUrl(projectId, name));
    } catch {
      return undefined;
    }
    if (!response.ok) {
      return undefined;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    assets.set(name, bytes);
    assets.original.set(name, bytes);
    return bytes;
  };
  assets.materialize = async (pattern = /./) => {
    for (const name of names) {
      if (pattern.test(name)) {
        await assets.read?.(name);
      }
    }
  };
  return assets;
}

/** Load a project and its asset manifest together. */
export async function openLibraryProject(
  library: LocalLibrary,
  id: string,
): Promise<OpenedLibraryProject> {
  const [{ project }, { assets }] = await Promise.all([
    library.get(id, { timeoutMs: 30_000 }),
    library.assets(id, { timeoutMs: 10_000 }),
  ]);
  return { project, assets: createLibraryAssetMap(library, id, assets) };
}

/** A streamed library chart document plus its project metadata and asset map. */
export interface OpenedLibraryChartDocument {
  readonly project: LibraryProjectSummary;
  readonly chartDocument: ChartDocument;
  readonly assets: LibraryAssetMap;
}

/** Raw-line cache bounds; the document keeps its own working set. */
const MAX_CACHED_LINES = 512;
const MAX_CACHED_CHARS = 8 * 1024 * 1024;

/** Fetch library lines in bounded batches instead of retaining the whole chart. */
class LibraryChartLineProvider implements ChartLineProvider {
  readonly lineCount: number;
  private readonly library: LocalLibrary;
  private readonly id: string;
  private readonly cache = new Map<number, string>();
  private cachedChars = 0;
  private readonly batch = 64;

  /** Bind the provider to one library project. */
  constructor(library: LocalLibrary, id: string, lineCount: number) {
    this.library = library;
    this.id = id;
    this.lineCount = lineCount;
  }

  /** Read one raw line, fetching its surrounding batch on first use. */
  async readLine(index: number): Promise<string | undefined> {
    const cached = this.cache.get(index);
    if (cached !== undefined) {
      this.cache.delete(index);
      this.cache.set(index, cached);
      return cached;
    }
    const start = Math.floor(index / this.batch) * this.batch;
    const count = Math.min(this.batch, this.lineCount - start);
    const batch = await this.library.chartLines(this.id, start, count);
    const ranges = scanJsonArrayRanges(batch.raw);
    let requested: string | undefined;
    for (let offset = 0; offset < ranges.length; offset++) {
      const range = ranges[offset];
      const lineIndex = batch.start + offset;
      const raw = batch.raw.slice(range.start, range.end);
      if (lineIndex === index) {
        requested = raw;
      }
      this.cacheLine(lineIndex, raw);
    }
    return requested ?? this.cache.get(index);
  }

  /** Store one raw line and trim the oldest entries past the cache budget. */
  private cacheLine(index: number, raw: string): void {
    this.cache.set(index, raw);
    this.cachedChars += raw.length;
    while (
      this.cache.size > 1 &&
      (this.cache.size > MAX_CACHED_LINES || this.cachedChars > MAX_CACHED_CHARS)
    ) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      const removed = this.cache.get(oldest);
      this.cache.delete(oldest);
      this.cachedChars -= removed?.length ?? 0;
    }
  }
}

/**
 * Open a library project through the chart stream.
 *
 * Metadata comes from the summary endpoint, the chart arrives as frames, and
 * assets stay lazy behind the existing manifest map.
 */
export async function openLibraryChartDocument(
  library: LocalLibrary,
  id: string,
): Promise<OpenedLibraryChartDocument> {
  const [{ project }, { assets }] = await Promise.all([
    library.summary(id, { timeoutMs: 30_000 }),
    library.assets(id, { timeoutMs: 10_000 }),
  ]);
  const parsed = await parseChartByteStream(
    library.chartStream(id, { timeoutMs: 300_000, includeLines: false }),
    {
      materialize: false,
      provider: ({ lineCount }) => new LibraryChartLineProvider(library, id, lineCount),
      maxCachedLines: PAGED_DOCUMENT_MAX_LINES,
      maxCachedBytes: PAGED_DOCUMENT_MAX_BYTES,
    },
  );
  return {
    project,
    chartDocument: parsed.chartDocument,
    assets: createLibraryAssetMap(library, id, assets),
  };
}

/** The parts of a save that need the network: known manifest and pending bytes. */
export interface LibraryAssetCapture {
  names: string[];
  manifest: { name: string; hash: string }[];
  uploads: { name: string; bytes: Uint8Array }[];
}

/**
 * Split the live asset map into reusable hashes and changed bytes.
 *
 * A name that was never materialized still has a hash from the manifest, so
 * opening a large project and pressing Save does not download its music.
 * A name whose bytes differ by reference is uploaded; the service deduplicates
 * identical bytes by hash.
 */
export async function captureLibraryAssets(assets: AssetMap): Promise<LibraryAssetCapture> {
  const names = [...assetNames(assets)];
  const manifest: { name: string; hash: string }[] = [];
  const uploads: { name: string; bytes: Uint8Array }[] = [];
  const hashes = (assets as Partial<LibraryAssetMap>).hashes;
  const originals = (assets as Partial<LibraryAssetMap>).original;

  for (const name of names) {
    let bytes = assets.get(name);
    const hash = hashes?.get(name);
    // Unloaded bytes or the same byte reference mean the stored blob is current.
    const unchanged = hash !== undefined && (!bytes || originals?.get(name) === bytes);
    if (hash && unchanged) {
      manifest.push({ name, hash });
      continue;
    }
    if (!bytes && assets.read) {
      bytes = await assets.read(name);
    }
    if (!bytes) {
      // An unknown, unreadable name cannot be committed as a mapping.
      continue;
    }
    uploads.push({ name, bytes });
  }
  return { names, manifest, uploads };
}

/** Snapshot lazy desktop assets into a plain map for a first library import. */
export async function materializeAssets(assets: AssetMap): Promise<AssetMap> {
  const names = new Set(assetNames(assets));
  for (const name of names) {
    if (!assets.has(name) && assets.read) {
      const bytes = await assets.read(name);
      if (bytes) {
        assets.set(name, bytes);
      }
    }
  }
  const materialized = new Map(assets) as AssetMap;
  materialized.names = () => names;
  return materialized;
}
