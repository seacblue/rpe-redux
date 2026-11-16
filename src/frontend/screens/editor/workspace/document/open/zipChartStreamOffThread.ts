/**
 * Connects the archive chart worker to ChartDocument so compressed chart JSON
 * never crosses the UI thread as a large byte buffer.
 */
import { ChartDocument } from "../../../../../../core/global/chart/streaming/chartDocument.ts";
import type { ChartWorkerResponse } from "../../../../../../core/global/chart/streaming/chartStreamWorkerProtocol.ts";
import {
  PAGED_DOCUMENT_MAX_BYTES,
  PAGED_DOCUMENT_MAX_LINES,
  type ChartHeader,
  type ChartIndex,
  type ChartLineProvider,
  type ChartLineRead,
} from "../../../../../../core/global/chart/streaming/chartStreamTypes.ts";
import { readZip } from "../../../../../../core/utils/zip.ts";
import type { ArchiveReader } from "../../../../../../core/global/document/pez.ts";
import { openChartDocumentFromBytes } from "./chartStreamOffThread.ts";
import type { ChartLineRevisionSeed } from "../../../../../../core/global/chart/chartRevisionSeed.ts";

interface PendingLine {
  readonly promise: Promise<string | ChartLineRead | undefined>;
  resolve(value: string | ChartLineRead | undefined): void;
  reject(error: unknown): void;
}

class ArchiveChartLineProvider implements ChartLineProvider {
  readonly lineCount: number;
  private readonly worker: Worker;
  private readonly sessionId: number;
  private readonly pending = new Map<number, PendingLine>();
  private closed = false;

  /** Bind a ChartDocument provider to the archive worker. */
  constructor(worker: Worker, sessionId: number, lineCount: number) {
    this.worker = worker;
    this.sessionId = sessionId;
    this.lineCount = lineCount;
  }

  /** Request one line without returning the archive JSON to the caller. */
  readLine(index: number, signal?: AbortSignal): Promise<string | ChartLineRead | undefined> {
    if (this.closed) {
      return Promise.reject(new Error("Chart archive stream is closed"));
    }
    const existing = this.pending.get(index);
    if (existing) {
      return existing.promise;
    }
    let resolveLine!: (value: string | ChartLineRead | undefined) => void;
    let rejectLine!: (error: unknown) => void;
    const promise = new Promise<string | ChartLineRead | undefined>((resolve, reject) => {
      resolveLine = resolve;
      rejectLine = reject;
    });
    this.pending.set(index, { promise, resolve: resolveLine, reject: rejectLine });
    if (signal?.aborted) {
      this.pending.delete(index);
      rejectLine(new DOMException("Chart archive stream aborted", "AbortError"));
      return promise;
    }
    this.worker.postMessage({ id: this.sessionId, kind: "line", index });
    return promise;
  }

  /** Accept one line response from the archive worker. */
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

  /** Reject every pending line when the worker fails. */
  fail(error: unknown): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  /** Close the provider and release the archive worker. */
  close(): void {
    this.fail(new Error("Chart archive stream is closed"));
  }
}

type ArchiveLimits = Omit<
  Parameters<ArchiveReader>[1],
  "onProgress" | "onEntryName" | "entryFilter"
>;

/** Open one archive entry through the fused archive/index worker. */
export async function openChartDocumentFromArchive(
  source: ArrayBuffer,
  limits: ArchiveLimits,
  name: string,
): Promise<{ chartDocument: ChartDocument; dispose(): void }> {
  if (typeof Worker === "undefined") {
    const files = await readZip(source, { ...limits, only: [name] });
    const bytes = files.get(name);
    if (!bytes) {
      throw new Error(`Chart entry is missing: ${name}`);
    }
    return openChartDocumentFromBytes(bytes, name);
  }
  let worker: Worker;
  try {
    worker = new Worker(new URL("./zipChartStreamWorker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    const files = await readZip(source, { ...limits, only: [name] });
    const bytes = files.get(name);
    if (!bytes) {
      throw new Error(`Chart entry is missing: ${name}`);
    }
    return openChartDocumentFromBytes(bytes, name);
  }
  const sessionId = 0;
  let header: ChartHeader | null = null;
  let index: ChartIndex | null = null;
  let provider: ArchiveChartLineProvider | null = null;
  let document: ChartDocument | null = null;
  let fingerprintsDone = false;
  const pendingSeeds: Array<{ start: number; seeds: readonly ChartLineRevisionSeed[] }> = [];
  let settleOpen: { resolve(): void; reject(error: unknown): void } | null = null;
  const opened = new Promise<void>((resolve, reject) => {
    settleOpen = { resolve, reject };
  });
  worker.onmessage = (event: MessageEvent<ChartWorkerResponse>) => {
    const message = event.data;
    if (message.kind === "header") {
      header = message.header;
    } else if (message.kind === "index") {
      index = message.index;
    } else if (message.kind === "fingerprints") {
      if (document) {
        message.seeds.forEach((seed, offset) =>
          document?.applyFingerprintSeed(message.start + offset, seed),
        );
      } else {
        pendingSeeds.push({ start: message.start, seeds: message.seeds });
      }
    } else if (message.kind === "fingerprints-done") {
      fingerprintsDone = true;
      document?.completeFingerprintHydration();
    } else if (message.kind === "line") {
      provider?.accept(message);
    } else {
      const error = new Error(message.message);
      provider?.fail(error);
      settleOpen?.reject(error);
      settleOpen = null;
    }
    if (header && index && !provider) {
      provider = new ArchiveChartLineProvider(worker, sessionId, index.lines.length);
      settleOpen?.resolve();
      settleOpen = null;
    }
  };
  worker.onerror = (event) => {
    const error = event.error instanceof Error ? event.error : new Error(String(event.message));
    provider?.fail(error);
    settleOpen?.reject(error);
    settleOpen = null;
  };
  const requestSource = source.slice(0);
  worker.postMessage({ id: sessionId, kind: "open", buffer: requestSource, name, limits }, [
    requestSource,
  ]);
  try {
    await opened;
  } catch (error) {
    worker.terminate();
    throw error;
  }
  if (!header || !index || !provider) {
    worker.terminate();
    throw new Error(`Chart archive stream did not produce a header for ${name}`);
  }
  document = new ChartDocument({
    header,
    index,
    provider,
    maxCachedLines: PAGED_DOCUMENT_MAX_LINES,
    maxCachedBytes: PAGED_DOCUMENT_MAX_BYTES,
  });
  for (const batch of pendingSeeds) {
    batch.seeds.forEach((seed, offset) =>
      document?.applyFingerprintSeed(batch.start + offset, seed),
    );
  }
  if (fingerprintsDone) {
    document.completeFingerprintHydration();
  }
  worker.postMessage({ id: sessionId, kind: "fingerprints" });
  const dispose = () => {
    provider?.close();
    worker.postMessage({ id: sessionId, kind: "close" });
    worker.terminate();
  };
  document.dispose = dispose;
  return { chartDocument: document, dispose };
}
