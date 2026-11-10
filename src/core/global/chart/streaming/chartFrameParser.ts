/**
 * Consumes chart stream frames into a paged document. Line payloads stay as raw
 * JSON text; the document parses only the lines it materializes. When an index
 * frame is absent, the parser builds one by parsing each line once.
 */
import type { BlockArea } from "../noise/blockArea.ts";
import type { Chart, JudgeLine } from "../chart.ts";
import { assertJudgeLineStructure } from "../chartValidation.ts";
import { TempoMap } from "../timing/tempo.ts";
import { ChartDocument } from "./chartDocument.ts";
import { headerContentFingerprint } from "./chartContentHash.ts";
import { scanJsonArrayRanges } from "./chartJsonScanner.ts";
import { summarizeChartLine } from "./chartLineSummary.ts";
import {
  decodeJsonFrame,
  decodeLineFrame,
  decodeLinesFrame,
  ChartFrameDecoder,
} from "./chartStreamCodec.ts";
import {
  CHART_FRAME,
  LINE_FLAG_INVALID,
  type ChartFrame,
  type ChartHeader,
  type ChartIndex,
  type ChartLineProvider,
} from "./chartStreamTypes.ts";

/** Result of consuming a chart frame stream. */
export interface ParsedChartFrames {
  readonly chartDocument: ChartDocument;
  /** Present when the caller requested eager materialization. */
  readonly chart: Chart | null;
}

/** Options for frame consumption. */
export interface ParseChartFramesOptions {
  readonly materialize?: boolean;
  readonly signal?: AbortSignal;
  /**
   * Build the line provider after the header and index are known. Hosts that
   * omit line frames use this to fetch lines from their own source on demand.
   */
  readonly provider?: (context: {
    header: ChartHeader;
    index: ChartIndex;
    lineCount: number;
  }) => ChartLineProvider;
  /** Working-set bounds for a paged document. */
  readonly maxCachedLines?: number;
  readonly maxCachedBytes?: number;
}

/** Header fields without the document-only line count. */
function headerHashValues(header: ChartHeader): Record<string, unknown> {
  return {
    ...header.extras,
    META: header.META,
    BPMList: header.BPMList,
    ...(header.judgeLineGroup ? { judgeLineGroup: header.judgeLineGroup } : {}),
    ...(header.blockAreaList ? { blockAreaList: header.blockAreaList } : {}),
    ...(header.effects ? { effects: header.effects } : {}),
    ...(header.shaderEvents ? { shaderEvents: header.shaderEvents } : {}),
    ...(header.markers ? { markers: header.markers } : {}),
  };
}

/** Build a provider over raw line text held by the parser. */
function rawProvider(raw: Map<number, string>, lineCount: number): ChartLineProvider {
  return {
    lineCount,
    async readLine(index: number) {
      return raw.get(index);
    },
  };
}

/** Build an index from raw lines when the source did not send one. */
function indexFromRaw(
  header: ChartHeader,
  raw: Map<number, string>,
  lineCount: number,
): ChartIndex {
  const tempo = new TempoMap(
    header.BPMList.length ? header.BPMList : [{ bpm: 120, startTime: [0, 0, 1] }],
  );
  const lines = Array.from({ length: lineCount }, (unused, index) => {
    const text = raw.get(index);
    let line: unknown = null;
    if (text !== undefined) {
      try {
        line = JSON.parse(text);
      } catch {
        line = null;
      }
    }
    const summary = summarizeChartLine(line, index, tempo);
    if (line !== null) {
      try {
        assertJudgeLineStructure(line as JudgeLine, index);
      } catch {
        return { ...summary, flags: summary.flags | LINE_FLAG_INVALID };
      }
    }
    return summary;
  });
  return {
    version: 1,
    headerDigest: headerContentFingerprint(headerHashValues(header)),
    lines,
    assetNames: [],
    totalBytes: 0,
    canonical: false,
  };
}

/**
 * Read all frames into a chart document.
 *
 * A missing index is built by parsing each raw line once. Eager callers receive
 * a materialized chart; paged callers receive the document and load lines on
 * demand.
 */
export async function parseChartFrames(
  frames: AsyncIterable<ChartFrame> | Iterable<ChartFrame>,
  options: ParseChartFramesOptions = {},
): Promise<ParsedChartFrames> {
  let header: ChartHeader | null = null;
  let index: ChartIndex | null = null;
  let effects: unknown[] | null = null;
  let blockAreas: BlockArea[] | null = null;
  const raw = new Map<number, string>();
  let maxIndex = -1;

  for await (const frame of frames) {
    if (options.signal?.aborted) {
      throw new DOMException("Chart stream aborted", "AbortError");
    }
    switch (frame.kind) {
      case CHART_FRAME.header:
        header = decodeJsonFrame<ChartHeader>(frame);
        break;
      case CHART_FRAME.index:
        index = decodeJsonFrame<ChartIndex>(frame);
        break;
      case CHART_FRAME.line: {
        const line = decodeLineFrame(frame);
        raw.set(line.index, line.raw);
        maxIndex = Math.max(maxIndex, line.index);
        break;
      }
      case CHART_FRAME.lines: {
        const batch = decodeLinesFrame(frame);
        const ranges = scanJsonArrayRanges(batch.raw);
        for (let offset = 0; offset < ranges.length; offset++) {
          const range = ranges[offset];
          const lineIndex = batch.start + offset;
          raw.set(lineIndex, batch.raw.slice(range.start, range.end));
          maxIndex = Math.max(maxIndex, lineIndex);
        }
        break;
      }
      case CHART_FRAME.effects:
        effects = decodeJsonFrame<unknown[]>(frame);
        break;
      case CHART_FRAME.block:
        blockAreas = decodeJsonFrame<BlockArea[]>(frame);
        break;
      case CHART_FRAME.error: {
        const error = decodeJsonFrame<{ message?: string }>(frame);
        throw new Error(error.message ?? "Chart stream failed");
      }
      case CHART_FRAME.end:
        break;
      default:
        break;
    }
  }

  if (!header) {
    throw new Error("Chart stream ended without a header");
  }
  if (effects) {
    header = { ...header, effects };
  }
  if (blockAreas) {
    header = { ...header, blockAreaList: blockAreas };
  }
  const lineCount = Math.max(header.lineCount, maxIndex + 1, index?.lines.length ?? 0);
  const resolvedIndex = index ?? indexFromRaw(header, raw, lineCount);
  const resolvedHeader = { ...header, lineCount };
  const provider =
    options.provider?.({ header: resolvedHeader, index: resolvedIndex, lineCount }) ??
    rawProvider(raw, lineCount);
  const chartDocument = new ChartDocument({
    header: resolvedHeader,
    index: resolvedIndex,
    provider,
    ...(options.maxCachedLines !== undefined ? { maxCachedLines: options.maxCachedLines } : {}),
    ...(options.maxCachedBytes !== undefined ? { maxCachedBytes: options.maxCachedBytes } : {}),
  });
  const chart = options.materialize
    ? await chartDocument.materializeAll({ signal: options.signal })
    : null;
  return { chartDocument, chart };
}

/** Decode a byte stream into frames and build a chart document. */
export async function parseChartByteStream(
  chunks: AsyncIterable<Uint8Array>,
  options: ParseChartFramesOptions = {},
): Promise<ParsedChartFrames> {
  const decoder = new ChartFrameDecoder();
  async function* frames(): AsyncGenerator<ChartFrame> {
    for await (const chunk of chunks) {
      for (const frame of decoder.push(chunk)) {
        yield frame;
      }
    }
  }
  return parseChartFrames(frames(), options);
}
