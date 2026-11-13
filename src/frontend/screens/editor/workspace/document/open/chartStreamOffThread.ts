/**
 * Main-thread front end for the chart stream worker. The worker owns the source
 * text and index; this adapter exposes it as a `ChartLineProvider` and falls
 * back to in-process scanning when workers are unavailable.
 */
import { ChartDocument } from "../../../../../../core/global/chart/streaming/chartDocument.ts";
import {
  buildChartIndex,
  chartHeaderFromScan,
} from "../../../../../../core/global/chart/streaming/chartLineSummary.ts";
import { scanChartJson } from "../../../../../../core/global/chart/streaming/chartJsonScanner.ts";
import type {
  ChartWorkerRequest,
  ChartWorkerResponse,
} from "../../../../../../core/global/chart/streaming/chartStreamWorkerProtocol.ts";
import {
  PAGED_DOCUMENT_MAX_BYTES,
  PAGED_DOCUMENT_MAX_LINES,
  type ChartHeader,
  type ChartIndex,
  type ChartLineProvider,
  type ChartLineRead,
} from "../../../../../../core/global/chart/streaming/chartStreamTypes.ts";
import { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import { lineRevisionSeedFromJson } from "../../../../../../core/global/chart/chartContentHash.ts";
import { yieldToHost } from "../../../../../../core/utils/yieldToHost.ts";
import type { ChartLineRevisionSeed } from "../../../../../../core/global/chart/chartRevisionSeed.ts";

/** An opened stream document plus the worker lifetime it depends on. */
export interface OpenedChartStream {
  readonly document: ChartDocument;
  dispose(): void;
}

/** Open archive bytes as a paged chart document for the core import seam. */
export async function openChartDocumentFromBytes(
  bytes: Uint8Array,
  name: string,
): Promise<{ chartDocument: ChartDocument; dispose(): void }> {
  const opened = await openChartStreamFromChunks(
    (async function* () {
      yield bytes;
    })(),
    name,
  );
  return { chartDocument: opened.document, dispose: opened.dispose };
}

/** A provider that asks the worker for one raw line at a time. */
class WorkerChartLineProvider implements ChartLineProvider {
  readonly lineCount: number;
  private readonly worker: Worker;
  private readonly sessionId: number;
  private readonly pending = new Map<
    number,
    {
      promise: Promise<string | ChartLineRead | undefined>;
      resolve(read: string | ChartLineRead | undefined): void;
      reject(error: unknown): void;
    }
  >();
  private closed = false;

  /** Bind the provider to one worker session. */
  constructor(worker: Worker, sessionId: number, lineCount: number) {
    this.worker = worker;
    this.sessionId = sessionId;
    this.lineCount = lineCount;
  }

  /** Read one raw line through the worker. */
  readLine(index: number, signal?: AbortSignal): Promise<string | ChartLineRead | undefined> {
    if (this.closed) {
      return Promise.reject(new Error("Chart stream is closed"));
    }
    const existing = this.pending.get(index);
    if (existing) {
      return existing.promise;
    }
    let resolveLine!: (read: string | ChartLineRead | undefined) => void;
    let rejectLine!: (error: unknown) => void;
    const promise = new Promise<string | ChartLineRead | undefined>((resolve, reject) => {
      resolveLine = resolve;
      rejectLine = reject;
    });
    this.pending.set(index, { promise, resolve: resolveLine, reject: rejectLine });
    if (signal?.aborted) {
      const pending = this.pending.get(index);
      this.pending.delete(index);
      pending?.reject(new DOMException("Chart stream aborted", "AbortError"));
      return promise;
    }
    const request: ChartWorkerRequest = { id: this.sessionId, kind: "line", index };
    this.worker.postMessage(request);
    return promise;
  }

  /** Resolve one worker line response. */
  accept(message: Extract<ChartWorkerResponse, { kind: "line" }>): void {
    const pending = this.pending.get(message.index);
    if (!pending) {
      return;
    }
    this.pending.delete(message.index);
    pending.resolve(
      message.raw === null ? undefined : { raw: message.raw, valueDigests: message.valueDigests },
    );
  }

  /** Reject every in-flight read and stop accepting new ones. */
  fail(error: unknown): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  /** Mark the provider closed without rejecting already-resolved reads. */
  close(): void {
    this.fail(new Error("Chart stream is closed"));
  }
}

/** Scan a source in the current thread when a worker cannot be created. */
function localDocument(bytes: ArrayBuffer): OpenedChartStream {
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  const scan = scanChartJson(text);
  const header = chartHeaderFromScan(scan);
  const tempo = new TempoMap(
    header.BPMList.length ? header.BPMList : [{ bpm: 120, startTime: [0, 0, 1] }],
  );
  const index = buildChartIndex(scan, tempo, { includeFingerprints: false });
  const provider: ChartLineProvider = {
    lineCount: scan.lineRanges.length,
    async readLine(lineIndex: number) {
      const range = scan.lineRanges[lineIndex];
      return range ? scan.text.slice(range.start, range.end) : undefined;
    },
  };
  const document = new ChartDocument({
    header,
    index,
    provider,
    maxCachedLines: PAGED_DOCUMENT_MAX_LINES,
    maxCachedBytes: PAGED_DOCUMENT_MAX_BYTES,
  });
  void hydrateLocalFingerprints(document, scan);
  return {
    document,
    dispose() {},
  };
}

/** Compute fallback fingerprints in bounded slices so the main thread can paint between them. */
async function hydrateLocalFingerprints(
  document: ChartDocument,
  scan: ReturnType<typeof scanChartJson>,
): Promise<void> {
  for (let start = 0; start < scan.lineRanges.length; start += 4) {
    for (let index = start; index < Math.min(scan.lineRanges.length, start + 4); index += 1) {
      const range = scan.lineRanges[index];
      document.applyFingerprintSeed(
        index,
        lineRevisionSeedFromJson(scan.text.slice(range.start, range.end)),
      );
    }
    await yieldToHost();
  }
  document.completeFingerprintHydration();
}

/** Collect an async chunk source into one exact ArrayBuffer. */
async function collectChunks(chunks: AsyncIterable<Uint8Array>): Promise<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of chunks) {
    parts.push(chunk);
    total += chunk.length;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes.buffer;
}

/** Open one chart source through the worker, or in-process when unavailable. */
export async function openChartStreamOffThread(
  bytes: ArrayBuffer,
  name: string,
): Promise<OpenedChartStream> {
  return openChartStreamFromChunks(
    (async function* () {
      yield new Uint8Array(bytes);
    })(),
    name,
  );
}

/** Open a chart source from an arbitrary chunk stream. */
export async function openChartStreamFromChunks(
  chunks: AsyncIterable<Uint8Array>,
  name: string,
): Promise<OpenedChartStream> {
  if (typeof Worker === "undefined") {
    return localDocument(await collectChunks(chunks));
  }
  let worker: Worker;
  try {
    worker = new Worker(new URL("./chartStreamWorker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return localDocument(await collectChunks(chunks));
  }
  const sessionId = 0;
  let header: ChartHeader | null = null;
  let index: ChartIndex | null = null;
  let provider: WorkerChartLineProvider | null = null;
  let chartDocument: ChartDocument | null = null;
  let fingerprintsDone = false;
  const pendingFingerprintBatches: Array<{
    start: number;
    seeds: readonly ChartLineRevisionSeed[];
  }> = [];
  /** Install one worker seed batch on the document that owns the line slots. */
  const applySeeds = (
    document: ChartDocument,
    start: number,
    seeds: readonly ChartLineRevisionSeed[],
  ): void => {
    seeds.forEach((seed, offset) => document.applyFingerprintSeed(start + offset, seed));
  };
  let settleOpen: { resolve(): void; reject(error: unknown): void } | null = null;
  const opened = new Promise<void>((resolve, reject) => {
    settleOpen = { resolve, reject };
  });
  worker.onmessage = (event: MessageEvent<ChartWorkerResponse>) => {
    const message = event.data;
    if (message.kind === "header") {
      header = message.header;
      if (header && index) {
        provider = new WorkerChartLineProvider(worker, sessionId, index.lines.length);
        settleOpen?.resolve();
        settleOpen = null;
      }
      return;
    }
    if (message.kind === "index") {
      index = message.index;
      if (header && index) {
        provider = new WorkerChartLineProvider(worker, sessionId, index.lines.length);
        settleOpen?.resolve();
        settleOpen = null;
      }
      return;
    }
    if (message.kind === "fingerprints") {
      if (chartDocument) {
        applySeeds(chartDocument, message.start, message.seeds);
      } else {
        pendingFingerprintBatches.push({ start: message.start, seeds: message.seeds });
      }
      return;
    }
    if (message.kind === "fingerprints-done") {
      fingerprintsDone = true;
      chartDocument?.completeFingerprintHydration();
      return;
    }
    if (message.kind === "line") {
      provider?.accept(message);
      return;
    }
    const error = new Error(message.message || `Chart stream failed for ${name}`);
    provider?.fail(error);
    settleOpen?.reject(error);
    settleOpen = null;
  };
  worker.onerror = (event) => {
    const error = event.error instanceof Error ? event.error : new Error(String(event.message));
    provider?.fail(error);
    settleOpen?.reject(error);
    settleOpen = null;
  };
  try {
    worker.postMessage({ id: sessionId, kind: "open" });
    for await (const chunk of chunks) {
      const copy = chunk.slice();
      worker.postMessage({ id: sessionId, kind: "append", chunk: copy.buffer }, [copy.buffer]);
    }
    worker.postMessage({ id: sessionId, kind: "finish" });
    await opened;
  } catch (error) {
    worker.terminate();
    throw error;
  }
  if (!header || !index || !provider) {
    worker.terminate();
    throw new Error(`Chart stream did not produce a header for ${name}`);
  }
  const document = new ChartDocument({
    header,
    index,
    provider,
    maxCachedLines: PAGED_DOCUMENT_MAX_LINES,
    maxCachedBytes: PAGED_DOCUMENT_MAX_BYTES,
  });
  chartDocument = document;
  for (const batch of pendingFingerprintBatches) {
    applySeeds(document, batch.start, batch.seeds);
  }
  if (fingerprintsDone) {
    document.completeFingerprintHydration();
  }
  const dispose = () => {
    provider?.close();
    worker.postMessage({ id: sessionId, kind: "close" });
    worker.terminate();
  };
  document.dispose = dispose;
  return { document, dispose };
}
