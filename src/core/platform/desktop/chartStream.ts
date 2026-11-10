/**
 * Native chart-stream adapter. `open_document_stream` sends binary frames; this
 * module builds a `ChartDocument` and serves random line reads through
 * `read_chart_lines` without materializing the whole chart on the UI thread.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import { ChartDocument } from "../../global/chart/streaming/chartDocument.ts";
import {
  ChartFrameDecoder,
  decodeJsonFrame,
  decodeLinesFrame,
} from "../../global/chart/streaming/chartStreamCodec.ts";
import { scanJsonArrayRanges } from "../../global/chart/streaming/chartJsonScanner.ts";
import {
  CHART_FRAME,
  PAGED_DOCUMENT_MAX_BYTES,
  PAGED_DOCUMENT_MAX_LINES,
  type ChartHeader,
  type ChartIndex,
  type ChartLineProvider,
  type ChartLineSummary,
} from "../../global/chart/streaming/chartStreamTypes.ts";
import type { AssetEntry } from "../../global/document/desktopTypes.ts";

/** Metadata returned by `open_document_stream`. */
export interface OpenedStreamDocument {
  id: string;
  path: string;
  chart_name: string;
  entries: AssetEntry[];
  packed?: boolean;
  disk_snapshot?: string;
  rejected_external_resources?: string[];
  line_count: number;
}

/** A native streaming open plus the document that owns its line source. */
export interface NativeChartStream {
  readonly opened: OpenedStreamDocument;
  readonly document: ChartDocument;
}

/** Largest line batch the native provider asks for. */
const MAX_BATCH_BYTES = 16 * 1024 * 1024;
/** Largest slice returned by one `read_chart_line_chunk` call. */
const MAX_LINE_CHUNK_BYTES = 4 * 1024 * 1024;
/** Raw-line cache bounds; the document keeps its own working set. */
const MAX_CACHED_LINES = 512;
const MAX_CACHED_CHARS = 8 * 1024 * 1024;
/** Upper bound on lines per native batch before the byte budget applies. */
const MAX_BATCH_LINES = 64;

/** One contiguous native line batch. */
interface LineWindow {
  start: number;
  count: number;
}

/** Decoded raw text and ranges for one native line batch. */
interface LineBatch {
  start: number;
  count: number;
  raw: string;
  ranges: readonly { start: number; end: number }[];
}

/** Split line summaries into byte-bounded windows used for batch reads. */
function buildLineWindows(lines: readonly ChartLineSummary[]): LineWindow[] {
  const windows: LineWindow[] = [];
  let start = 0;
  while (start < lines.length) {
    let count = 0;
    let bytes = 2;
    while (start + count < lines.length && count < MAX_BATCH_LINES) {
      const extra = (lines[start + count]?.byteLength ?? 0) + (count > 0 ? 1 : 0);
      if (count > 0 && bytes + extra > MAX_BATCH_BYTES) {
        break;
      }
      bytes += extra;
      count += 1;
    }
    const actual = Math.max(1, count);
    windows.push({ start, count: actual });
    start += actual;
  }
  return windows;
}

/** Read one line from a native document in bounded, shared batches. */
class NativeChartLineProvider implements ChartLineProvider {
  readonly lineCount: number;
  private readonly id: string;
  private readonly lines: readonly ChartLineSummary[];
  private readonly windows: readonly LineWindow[];
  private readonly cache = new Map<number, string>();
  private readonly pendingBatches = new Map<string, Promise<LineBatch>>();
  private readonly recentBatches = new Map<string, LineBatch>();
  private cachedChars = 0;

  /** Bind the provider to one native streaming document. */
  constructor(id: string, lines: readonly ChartLineSummary[]) {
    this.id = id;
    this.lines = lines;
    this.lineCount = lines.length;
    this.windows = buildLineWindows(lines);
  }

  /** Read one raw line, sharing an in-flight batch with other readers. */
  async readLine(index: number): Promise<string | undefined> {
    const cached = this.cache.get(index);
    if (cached !== undefined) {
      this.cache.delete(index);
      this.cache.set(index, cached);
      return cached;
    }
    const summary = this.lines[index];
    if (!summary) {
      return undefined;
    }
    if (summary.byteLength > MAX_BATCH_BYTES) {
      return this.readChunkedLine(index, summary);
    }
    const window = this.windowFor(index);
    const batch = await this.readBatch(window);
    const range = batch.ranges[index - batch.start];
    if (!range) {
      return undefined;
    }
    const raw = batch.raw.slice(range.start, range.end);
    this.cacheLine(index, raw);
    return raw;
  }

  /** Find the byte-bounded window containing one line. */
  private windowFor(index: number): LineWindow {
    let low = 0;
    let high = this.windows.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const window = this.windows[middle];
      if (index < window.start) {
        high = middle - 1;
      } else if (index >= window.start + window.count) {
        low = middle + 1;
      } else {
        return window;
      }
    }
    return { start: index, count: 1 };
  }

  /** Fetch one batch, reusing an in-flight or recently decoded result. */
  private async readBatch(window: LineWindow): Promise<LineBatch> {
    const key = `${window.start}:${window.count}`;
    const recent = this.recentBatches.get(key);
    if (recent) {
      return recent;
    }
    let pending = this.pendingBatches.get(key);
    if (!pending) {
      pending = this.fetchBatch(window);
      this.pendingBatches.set(key, pending);
      void pending.then(
        () => this.pendingBatches.delete(key),
        () => this.pendingBatches.delete(key),
      );
    }
    return pending;
  }

  /** Read one batch frame from the native host. */
  private async fetchBatch(window: LineWindow): Promise<LineBatch> {
    const response = await invoke<ArrayBuffer | number[]>("read_chart_lines", {
      id: this.id,
      start: window.start,
      count: window.count,
    });
    const bytes =
      response instanceof ArrayBuffer ? new Uint8Array(response) : Uint8Array.from(response);
    const frames = new ChartFrameDecoder().push(bytes);
    const frame = frames.find((entry) => entry.kind === CHART_FRAME.lines);
    if (!frame) {
      throw new Error("Chart line batch was not returned");
    }
    const batch = decodeLinesFrame(frame);
    const decoded: LineBatch = {
      start: batch.start,
      count: batch.count,
      raw: batch.raw,
      ranges: scanJsonArrayRanges(batch.raw),
    };
    this.recentBatches.set(`${window.start}:${window.count}`, decoded);
    while (this.recentBatches.size > 2) {
      const oldest = this.recentBatches.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.recentBatches.delete(oldest);
    }
    return decoded;
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

  /** Read one line that is too large for the batch frame ceiling. */
  private async readChunkedLine(
    index: number,
    summary: ChartLineSummary,
  ): Promise<string | undefined> {
    const decoder = new TextDecoder();
    let raw = "";
    let offset = 0;
    while (offset < summary.byteLength) {
      const length = Math.min(MAX_LINE_CHUNK_BYTES, summary.byteLength - offset);
      const response = await invoke<ArrayBuffer | number[]>("read_chart_line_chunk", {
        id: this.id,
        index,
        offset,
        length,
      });
      const bytes =
        response instanceof ArrayBuffer ? new Uint8Array(response) : Uint8Array.from(response);
      if (!bytes.length) {
        break;
      }
      raw += decoder.decode(bytes, { stream: true });
      offset += bytes.length;
    }
    raw += decoder.decode();
    this.cacheLine(index, raw);
    return raw;
  }
}

/** Convert a raw channel payload into bytes. */
function channelBytes(value: ArrayBuffer | number[] | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return Uint8Array.from(value);
}

/**
 * Open one native chart through the binary stream command.
 *
 * The command streams all line frames for Phase 1; the document still owns a
 * random-access provider, so later paging can read only the lines it needs.
 */
export async function openNativeChartStream(
  path: string,
  options: { allowExternalResources?: boolean } = {},
): Promise<NativeChartStream> {
  const onStream = new Channel<ArrayBuffer | number[]>();
  const onProgress = new Channel<{ completed: number; total: number }>();
  const decoder = new ChartFrameDecoder();
  let header: ChartHeader | null = null;
  let index: ChartIndex | null = null;
  let streamError: Error | null = null;
  let settle: (() => void) | null = null;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  onStream.onmessage = (message) => {
    for (const frame of decoder.push(channelBytes(message))) {
      if (frame.kind === CHART_FRAME.header) {
        header = decodeJsonFrame<ChartHeader>(frame);
      } else if (frame.kind === CHART_FRAME.index) {
        index = decodeJsonFrame<ChartIndex>(frame);
      } else if (frame.kind === CHART_FRAME.error) {
        const payload = decodeJsonFrame<{ message?: string }>(frame);
        streamError = new Error(payload.message ?? "Chart stream failed");
        settle?.();
      } else if (frame.kind === CHART_FRAME.end) {
        settle?.();
      }
    }
  };
  onProgress.onmessage = () => undefined;
  const opened = await invoke<OpenedStreamDocument>("open_document_stream", {
    path,
    onStream,
    onProgress,
    allowExternalResources: options.allowExternalResources === true,
    includeLines: false,
  });
  await done;
  if (streamError) {
    await invoke("close_document", { id: opened.id }).catch(() => undefined);
    throw streamError;
  }
  const resolvedHeader = header as ChartHeader | null;
  const resolvedIndex = index as ChartIndex | null;
  if (!resolvedHeader || !resolvedIndex) {
    await invoke("close_document", { id: opened.id }).catch(() => undefined);
    throw new Error(`Chart stream did not produce a header for ${opened.chart_name}`);
  }
  const provider = new NativeChartLineProvider(opened.id, resolvedIndex.lines);
  return {
    opened,
    document: new ChartDocument({
      header: resolvedHeader,
      index: resolvedIndex,
      provider,
      maxCachedLines: PAGED_DOCUMENT_MAX_LINES,
      maxCachedBytes: PAGED_DOCUMENT_MAX_BYTES,
    }),
  };
}
