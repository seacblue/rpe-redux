/**
 * Serializes a save or recovery snapshot off the UI thread, falling back
 * in-process for custom serializers or hosts without workers. The save service
 * owns snapshot timing; this module only returns the chart text.
 */
import { serializeChart } from "../../../../../../core/global/chart/chart.ts";
import { registeredChartDocument } from "../../../../../../core/global/chart/streaming/chartDocumentRegistry.ts";
import { extensionRegistry } from "../../../../../../core/extensions/runtime.ts";
import { yieldToHost } from "../../../../../../core/utils/yieldToHost.ts";

interface SerializeResponse {
  id: number;
  text: string;
}

interface PendingSerialize {
  chart: unknown;
  mode: SerializeMode;
  resolve(text: string): void;
  reject(error: unknown): void;
}

/** The two serializers share one worker but use different output rules. */
type SerializeMode = "chart" | "json";

/**
 * One worker per editor lifetime. Requests are matched by id; the posted chart
 * is retained only for the duration of one message.
 */
const serializer = {
  worker: null as Worker | null,
  pending: new Map<number, PendingSerialize>(),
  nextRequestId: 1,
};

/** Serializes a chart on the main thread. */
function inProcess(chart: unknown): string {
  return serializeChart(chart);
}

/** Serialize one chart on the main thread for the requested output mode. */
function inProcessMode(chart: unknown, mode: SerializeMode): string {
  return mode === "json" ? JSON.stringify(chart) : inProcess(chart);
}

/** Completes one pending request through the main-thread serializer. */
function fallback(request: PendingSerialize): void {
  try {
    request.resolve(inProcessMode(request.chart, request.mode));
  } catch (error) {
    request.reject(error);
  }
}

/** Returns the shared serializer worker, or null when workers are unavailable. */
function workerInstance(): Worker | null {
  if (serializer.worker) {
    return serializer.worker;
  }
  if (typeof Worker === "undefined") {
    return null;
  }
  try {
    const worker = new Worker(new URL("./chartSerializeWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<SerializeResponse>) => {
      const request = serializer.pending.get(event.data.id);
      if (!request) {
        return;
      }
      serializer.pending.delete(event.data.id);
      request.resolve(event.data.text);
    };
    worker.onerror = () => {
      // A failed module worker is retried by the next save; this request still
      // has to complete through the in-process path.
      const pending = [...serializer.pending.values()];
      serializer.pending.clear();
      worker.terminate();
      if (serializer.worker === worker) {
        serializer.worker = null;
      }
      pending.forEach(fallback);
    };
    serializer.worker = worker;
    return worker;
  } catch {
    return null;
  }
}

/** Bounded producer/consumer queue for serialization chunks. */
class ChunkQueue {
  private readonly values: string[] = [];
  private queuedChars = 0;
  private closed = false;
  private failure: unknown;
  private reader: (() => void) | null = null;
  private writer: (() => void) | null = null;
  private readonly maxChunks = 8;
  private readonly maxChars = 4 * 1024 * 1024;

  /** Append one chunk, waiting while the consumer is behind. */
  async push(chunk: string): Promise<void> {
    if (this.closed) {
      throw new Error("Serialization stream closed");
    }
    this.values.push(chunk);
    this.queuedChars += chunk.length;
    this.reader?.();
    this.reader = null;
    while (
      !this.closed &&
      (this.values.length >= this.maxChunks || this.queuedChars >= this.maxChars)
    ) {
      await new Promise<void>((resolve) => {
        this.writer = resolve;
      });
    }
  }

  /** Mark the producer finished, or fail the stream. */
  close(error?: unknown): void {
    this.closed = true;
    this.failure = error;
    this.reader?.();
    this.reader = null;
    this.writer?.();
    this.writer = null;
  }

  /** Yield chunks as they arrive, with backpressure on the producer. */
  async *drain(): AsyncIterable<string> {
    try {
      while (true) {
        const chunk = this.values.shift();
        if (chunk !== undefined) {
          this.queuedChars -= chunk.length;
          this.writer?.();
          this.writer = null;
          yield chunk;
          continue;
        }
        if (this.closed) {
          if (this.failure) {
            throw this.failure;
          }
          return;
        }
        await new Promise<void>((resolve) => {
          this.reader = resolve;
        });
      }
    } finally {
      this.close();
    }
  }
}

/**
 * Serialize a save snapshot as JSON chunks. A document-backed facade uses its
 * line store and streams through a bounded queue; other charts use the existing
 * whole-chart worker path.
 */
export async function* serializeChartStream(chart: unknown): AsyncIterable<string> {
  const document =
    chart && typeof chart === "object" ? registeredChartDocument(chart as object) : undefined;
  if (document?.serialize) {
    const queue = new ChunkQueue();
    void document
      .serialize((chunk) => queue.push(chunk))
      .then(
        () => queue.close(),
        (error) => queue.close(error),
      );
    yield* queue.drain();
    return;
  }
  yield await serializeChartOffThread(chart);
}

/**
 * Serializes the save snapshot away from the UI thread.
 *
 * The worker receives the immutable snapshot and returns the exact
 * `serializeChart` text; hosts without workers, and charts with custom
 * serializers, fall back to the main-thread path.
 */
export async function serializeChartOffThread(chart: unknown): Promise<string> {
  const document =
    chart && typeof chart === "object" ? registeredChartDocument(chart as object) : undefined;
  if (document?.serialize) {
    const chunks: string[] = [];
    await document.serialize((chunk) => {
      chunks.push(chunk);
    });
    return chunks.join("");
  }
  const hasCustomSerializer =
    extensionRegistry.hasHook("chart:serialize") || extensionRegistry.hasHook("chart:validate");
  return serializeOffThread(chart, "chart", hasCustomSerializer);
}

/**
 * Serialize the room chart as plain JSON away from the UI thread.
 *
 * Room snapshots use the same chart shape as the live editor; they do not run
 * save hooks or legacy-field stripping. A worker failure falls back to
 * `JSON.stringify` on the main thread so a create can still proceed.
 */
export async function serializeChartJsonOffThread(chart: unknown): Promise<string> {
  return serializeOffThread(chart, "json", false);
}

/** Share the line-by-line posting path between the save and room serializers. */
async function serializeOffThread(
  chart: unknown,
  mode: SerializeMode,
  forceInProcess: boolean,
): Promise<string> {
  if (forceInProcess) {
    return inProcessMode(chart, mode);
  }
  const worker = workerInstance();
  if (!worker) {
    return inProcessMode(chart, mode);
  }
  const id = serializer.nextRequestId++;
  return new Promise<string>((resolve, reject) => {
    serializer.pending.set(id, { chart, mode, resolve, reject });
    const fail = (error: unknown): void => {
      serializer.pending.delete(id);
      worker.terminate();
      if (serializer.worker === worker) {
        serializer.worker = null;
      }
      try {
        resolve(inProcessMode(chart, mode));
      } catch {
        reject(error);
      }
    };
    void (async () => {
      try {
        const record =
          chart && typeof chart === "object" && !Array.isArray(chart)
            ? (chart as Record<string, unknown>)
            : null;
        const lines = Array.isArray(record?.judgeLineList) ? record.judgeLineList : null;
        if (!record || !lines) {
          worker.postMessage({ id, kind: "whole", chart, mode });
          return;
        }
        // Send the header once and each judge line separately so no single
        // message clones the whole chart; yielding keeps this loop off the
        // long-task path.
        const { judgeLineList: _lines, ...header } = record;
        worker.postMessage({
          id,
          kind: "start",
          chart: header,
          lineCount: lines.length,
          mode,
        });
        let lastYield = performance.now();
        for (let index = 0; index < lines.length; index++) {
          if (!serializer.pending.has(id)) {
            return;
          }
          worker.postMessage({ id, kind: "line", index, line: lines[index] });
          // A line can be small enough that the time budget never trips, yet a
          // series of them still adds up; bound the task by line count too.
          if (index % 2 === 1 || performance.now() - lastYield >= 4) {
            await yieldToHost();
            lastYield = performance.now();
          }
        }
        if (serializer.pending.has(id)) {
          worker.postMessage({ id, kind: "end" });
        }
      } catch (error) {
        fail(error);
      }
    })();
  });
}
