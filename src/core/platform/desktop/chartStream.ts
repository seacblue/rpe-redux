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
  type ChartHeader,
  type ChartIndex,
  type ChartLineProvider,
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

/** Read one line from a native document in bounded batches. */
class NativeChartLineProvider implements ChartLineProvider {
  readonly lineCount: number;
  private readonly id: string;
  private readonly cache = new Map<number, string>();
  private readonly batch = 64;

  /** Bind the provider to one native streaming document. */
  constructor(id: string, lineCount: number) {
    this.id = id;
    this.lineCount = lineCount;
  }

  /** Read one raw line, fetching its surrounding batch on first use. */
  async readLine(index: number): Promise<string | undefined> {
    const cached = this.cache.get(index);
    if (cached !== undefined) {
      return cached;
    }
    const start = Math.floor(index / this.batch) * this.batch;
    const count = Math.min(this.batch, this.lineCount - start);
    const response = await invoke<ArrayBuffer | number[]>("read_chart_lines", {
      id: this.id,
      start,
      count,
    });
    const bytes =
      response instanceof ArrayBuffer ? new Uint8Array(response) : Uint8Array.from(response);
    const decoder = new ChartFrameDecoder();
    const frames = decoder.push(bytes);
    const frame = frames.find((entry) => entry.kind === CHART_FRAME.lines);
    if (!frame) {
      return undefined;
    }
    const batch = decodeLinesFrame(frame);
    const ranges = scanJsonArrayRanges(batch.raw);
    for (let offset = 0; offset < ranges.length; offset++) {
      const range = ranges[offset];
      this.cache.set(batch.start + offset, batch.raw.slice(range.start, range.end));
    }
    return this.cache.get(index);
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
  const provider = new NativeChartLineProvider(opened.id, resolvedIndex.lines.length);
  return {
    opened,
    document: new ChartDocument({ header: resolvedHeader, index: resolvedIndex, provider }),
  };
}
