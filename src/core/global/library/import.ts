/**
 * Imports a chart and its resources into the SQLite library.
 *
 * Opening an external JSON/PEZ is an import, not a live file binding. The
 * caller supplies the already parsed chart and asset map; this module reads the
 * lazy bytes and writes a normal library project. A chart opened through the
 * streaming host is a document facade, so its text comes from the document's
 * line serializer instead of the placeholder lines on the facade object.
 */
import { serializeChart } from "../chart/chart.ts";
import { registeredChartDocument } from "../chart/streaming/chartDocumentRegistry.ts";
import type { AssetMap } from "../document/types.ts";
import { materializeAssets } from "./document.ts";
import { saveLibraryDocument, type LibrarySaveResult } from "./save.ts";
import { LocalLibraryError, type LocalLibrary } from "./client.ts";
import type { LibraryViewState } from "./types.ts";
import { throwIfAborted } from "../../utils/abort.ts";

/** Keep ordinary JSON requests below the sidecar's 64 MiB request cap. */
const STREAMED_IMPORT_THRESHOLD_BYTES = 48 * 1024 * 1024;
/** Reduce upload request overhead while keeping each raw chunk comfortably bounded. */
const IMPORT_CHUNK_CHARS = 4 * 1024 * 1024;

interface SerializedImportChart {
  readonly chartJson: string;
  readonly chartChunks?: AsyncIterable<string>;
}

/** Input for importing an opened document into the library. */
export interface LibraryImportInput {
  library: LocalLibrary;
  chart: unknown;
  name: string;
  assets: AssetMap;
  /** Existing project to refresh, or omitted to create a new one. */
  projectId?: string;
  group?: string;
  viewState?: LibraryViewState;
  assetFolders?: readonly string[];
  /** Reuse text the caller already produced. */
  chartJson?: string;
  onProgress?: (value: number) => void;
  /** Cooperatively cancel between chart serialization and library writes. */
  signal?: AbortSignal;
}

/**
 * Serialize the chart text a library import should store.
 *
 * A document-backed facade keeps only placeholder lines in memory; its
 * serializer streams the real lines from the native source. Charts parsed in
 * memory still use the shared whole-chart serializer.
 */
/** Estimate a paged document's serialized size without materializing its lines. */
function estimatedDocumentBytes(document: {
  readonly index?: { readonly lines?: readonly { readonly byteLength?: number }[] } | null;
}): number {
  return (document.index?.lines ?? []).reduce(
    (total, line) => total + Math.max(0, Number(line.byteLength) || 0),
    0,
  );
}

/** Stream a document serializer with one chunk of backpressure. */
async function* serializeDocumentChunks(document: {
  serialize(sink: (chunk: string) => Promise<void> | void): Promise<void>;
}): AsyncIterable<string> {
  const pending: { chunk: string; release: () => void }[] = [];
  let wake: (() => void) | null = null;
  let producerDone = false;
  let producerError: unknown;
  let cancelled = false;
  const producer = document
    .serialize(
      (chunk) =>
        new Promise<void>((resolve) => {
          if (cancelled) {
            resolve();
            return;
          }
          pending.push({ chunk, release: resolve });
          wake?.();
          wake = null;
        }),
    )
    .catch((error: unknown) => {
      producerError = error;
    })
    .finally(() => {
      producerDone = true;
      wake?.();
      wake = null;
    });
  try {
    while (!producerDone || pending.length) {
      if (!pending.length) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      const item = pending.shift();
      if (!item) {
        continue;
      }
      yield item.chunk;
      item.release();
    }
    await producer;
    if (producerError !== undefined) {
      throw producerError;
    }
  } finally {
    cancelled = true;
    for (const item of pending) {
      item.release();
    }
  }
}

/** Coalesce many line-level serializer chunks into a small number of HTTP bodies. */
async function* coalesceSerializedChunks(chunks: AsyncIterable<string>): AsyncIterable<string> {
  let buffered = "";
  for await (const chunk of chunks) {
    buffered += chunk;
    while (buffered.length >= IMPORT_CHUNK_CHARS) {
      yield buffered.slice(0, IMPORT_CHUNK_CHARS);
      buffered = buffered.slice(IMPORT_CHUNK_CHARS);
    }
  }
  if (buffered) {
    yield buffered;
  }
}

/** Serialize an opened chart while keeping a large paged chart out of one giant string. */
async function serializeImportedChart(chart: unknown): Promise<SerializedImportChart> {
  const document =
    chart && typeof chart === "object" ? registeredChartDocument(chart as object) : undefined;
  if (document?.serialize) {
    const indexedDocument = document as unknown as {
      readonly index?: { readonly lines?: readonly { readonly byteLength?: number }[] } | null;
    };
    if (estimatedDocumentBytes(indexedDocument) > STREAMED_IMPORT_THRESHOLD_BYTES) {
      return {
        chartJson: "{}",
        chartChunks: coalesceSerializedChunks(
          serializeDocumentChunks({
            serialize: (sink) => document.serialize!(sink),
          }),
        ),
      };
    }
    const chunks: string[] = [];
    await document.serialize((chunk) => {
      chunks.push(chunk);
    });
    return { chartJson: chunks.join("") };
  }
  if (document) {
    return { chartJson: serializeChart(await document.materializeAll()) };
  }
  return { chartJson: serializeChart(chart) };
}

/** Split a serialized chart without breaking a UTF-16 surrogate pair. */
async function* chunkSerializedChart(chartJson: string): AsyncIterable<string> {
  for (let start = 0; start < chartJson.length;) {
    let end = Math.min(chartJson.length, start + IMPORT_CHUNK_CHARS);
    if (
      end < chartJson.length &&
      end > start &&
      chartJson.charCodeAt(end - 1) >= 0xd800 &&
      chartJson.charCodeAt(end - 1) <= 0xdbff
    ) {
      end -= 1;
    }
    yield chartJson.slice(start, end);
    start = end;
  }
}

/** Import one opened document into the library. */
export async function importChartToLibrary(input: LibraryImportInput): Promise<LibrarySaveResult> {
  throwIfAborted(input.signal);
  const serialized =
    input.chartJson !== undefined
      ? { chartJson: input.chartJson }
      : await serializeImportedChart(input.chart);
  throwIfAborted(input.signal);
  const chartJson = serialized.chartJson;
  const chartChunks =
    serialized.chartChunks ??
    (chartJson.length > STREAMED_IMPORT_THRESHOLD_BYTES
      ? chunkSerializedChart(chartJson)
      : undefined);
  const assets = await materializeAssets(input.assets);
  throwIfAborted(input.signal);
  const saveInput = {
    library: input.library,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    chart: input.chart,
    chartJson,
    ...(chartChunks ? { chartChunks } : {}),
    name: input.name,
    assets,
    ...(input.group ? { group: input.group } : {}),
    ...(input.viewState ? { viewState: input.viewState } : {}),
    ...(input.assetFolders ? { assetFolders: input.assetFolders } : {}),
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  };
  try {
    return await saveLibraryDocument(saveInput);
  } catch (error) {
    if (!(input.projectId && error instanceof LocalLibraryError && error.status === 404)) {
      throw error;
    }
    // A path catalogue can reference a project that no longer exists. Retry as
    // a new project so re-importing that source repairs the stale identity
    // instead of surfacing the backend's missing-resource response.
    return saveLibraryDocument({ ...saveInput, projectId: undefined });
  }
}
