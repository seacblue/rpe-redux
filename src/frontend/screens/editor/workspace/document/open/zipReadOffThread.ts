/**
 * Runs PEZ archive reads in a worker when the host provides one, preserving ZIP
 * limits and progress. `readZip` remains the in-process fallback and the only
 * archive implementation.
 */
import { readZip } from "../../../../../../core/utils/zip.ts";
import type { ArchiveReader } from "../../../../../../core/global/document/pez.ts";
import type { AssetMap } from "../../../../../../core/global/document/types.ts";
import type { ChartDocument } from "../../../../../../core/global/chart/streaming/chartDocument.ts";
import { openChartDocumentFromArchive } from "./zipChartStreamOffThread.ts";

interface ZipProgress {
  id: number;
  kind: "progress";
  completed: number;
  total: number;
}

interface ZipResult {
  id: number;
  kind: "result";
  names?: string[];
  entries: Array<{ name: string; bytes: ArrayBuffer }>;
}

let nextRequestId = 1;

/** Read one deferred archive entry in a short-lived worker. */
function readZipEntryOffThread(
  source: ArrayBuffer,
  limits: Omit<Parameters<ArchiveReader>[1], "onProgress" | "onEntryName" | "entryFilter">,
  name: string,
): Promise<Uint8Array | undefined> {
  if (typeof Worker === "undefined") {
    return readZip(source, { ...limits, only: [name] }).then((files) => files.get(name));
  }
  let worker: Worker;
  try {
    worker = new Worker(new URL("./zipReadWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return readZip(source, { ...limits, only: [name] }).then((files) => files.get(name));
  }
  const id = nextRequestId++;
  const requestSource = source.slice(0);
  return new Promise<Uint8Array | undefined>((resolve) => {
    const finish = (): void => worker.terminate();
    worker.onmessage = (event: MessageEvent<ZipProgress | ZipResult>) => {
      if (event.data.id !== id || event.data.kind !== "result") {
        return;
      }
      finish();
      const entry = event.data.entries.find((candidate) => candidate.name === name);
      resolve(entry ? new Uint8Array(entry.bytes) : undefined);
    };
    worker.onerror = () => {
      finish();
      void readZip(source, { ...limits, only: [name] })
        .then((files) => resolve(files.get(name)))
        .catch(() => resolve(undefined));
    };
    worker.postMessage({ id, buffer: requestSource, limits: { ...limits, only: [name] } }, [
      requestSource,
    ]);
  });
}

/** Map of archive names whose bytes are inflated only when a consumer asks. */
class LazyArchiveAssetMap extends Map<string, Uint8Array> implements AssetMap {
  private readonly knownNames: ReadonlySet<string>;
  private readonly source: ArrayBuffer;
  private readonly limits: Omit<
    Parameters<ArchiveReader>[1],
    "onProgress" | "onEntryName" | "entryFilter"
  >;
  private readonly pending = new Map<string, Promise<Uint8Array | undefined>>();

  /** Create a lazy asset map with the eagerly read chart and metadata entries. */
  constructor(
    names: readonly string[],
    source: ArrayBuffer,
    limits: Omit<Parameters<ArchiveReader>[1], "onProgress" | "onEntryName" | "entryFilter">,
    entries: Array<{ name: string; bytes: ArrayBuffer }>,
  ) {
    super(entries.map(({ name, bytes }) => [name, new Uint8Array(bytes)]));
    this.knownNames = new Set(names);
    this.source = source;
    this.limits = limits;
  }

  /** Return every archive path, including bytes that are still deferred. */
  names(): Iterable<string> {
    return this.knownNames;
  }

  /** Open a chart in a worker that owns both ZIP inflation and chart indexing. */
  openChartDocument(name: string): Promise<{ chartDocument: ChartDocument; dispose(): void }> {
    return openChartDocumentFromArchive(this.source, this.limits, name);
  }

  /** Inflate one archive path and retain the resulting bytes for later reads. */
  async read(name: string): Promise<Uint8Array | undefined> {
    const loaded = this.get(name);
    if (loaded && loaded.byteLength > 0) {
      return loaded;
    }
    if (loaded) {
      // A chart entry may have been transferred directly to the chart worker.
      // Reopen it from the retained archive source if a fallback needs it.
      this.delete(name);
    }
    if (!this.knownNames.has(name)) {
      return undefined;
    }
    const existing = this.pending.get(name);
    if (existing) {
      return existing;
    }
    const pending = readZipEntryOffThread(this.source, this.limits, name).then((bytes) => {
      this.pending.delete(name);
      if (bytes) {
        this.set(name, bytes);
      }
      return bytes;
    });
    this.pending.set(name, pending);
    return pending;
  }
}

/** Read a PEZ archive off the UI thread while preserving ZIP limits and progress. */
export const readZipOffThread: ArchiveReader = (buffer, limits, onProgress) => {
  if (typeof Worker === "undefined") {
    return readZip(buffer, { ...limits, onProgress });
  }
  const worker = new Worker(new URL("./zipReadWorker.ts", import.meta.url), {
    type: "module",
  });
  const id = nextRequestId++;
  const source = buffer instanceof Uint8Array ? buffer.slice().buffer : buffer.slice(0);
  const workerSource = source.slice(0);
  // The progress callback stays local; only the numeric limits cross the
  // worker boundary, because functions cannot be structured-cloned.
  const limitsProgress = limits.onProgress;
  const workerLimits = { ...limits };
  delete workerLimits.onProgress;
  delete workerLimits.onEntryName;
  delete workerLimits.entryFilter;
  const progress = onProgress ?? limitsProgress;
  return new Promise<AssetMap>((resolve) => {
    const finish = (): void => worker.terminate();
    worker.onmessage = (event: MessageEvent<ZipProgress | ZipResult>) => {
      if (event.data.id !== id) {
        return;
      }
      if (event.data.kind === "progress") {
        void progress?.(event.data.completed, event.data.total);
        return;
      }
      finish();
      const names = event.data.names ?? event.data.entries.map((entry) => entry.name);
      resolve(new LazyArchiveAssetMap(names, source, workerLimits, event.data.entries));
    };
    worker.onerror = () => {
      finish();
      resolve(readZip(buffer, { ...workerLimits, onProgress: progress }));
    };
    worker.postMessage({ id, buffer: workerSource, limits: workerLimits }, [workerSource]);
  });
};
