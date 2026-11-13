/**
 * Shared types for the chart streaming pipeline: the header, per-line index,
 * frame kinds, and the source/provider contracts that feed a chart document.
 */
import type { BlockArea } from "../noise/blockArea.ts";
import type { BpmEntry, Chart, ChartMeta, JudgeLine } from "../chart.ts";
import type { ChartValueDigestGroup } from "../chartContentHash.ts";

/** Magic bytes that prefix a binary chart stream. */
export const CHART_STREAM_MAGIC = "RPE1";
/** Frame protocol version carried by the header frame. */
export const CHART_STREAM_VERSION = 1;

/** Paged document working-set budget used by editor hosts. */
export const PAGED_DOCUMENT_MAX_LINES = 32_000;
export const PAGED_DOCUMENT_MAX_BYTES = 256 * 1024 * 1024;
/** Maximum lines one time-window preload may load. */
export const PAGED_PRELOAD_MAX_LINES = 30_000;

/** Frame kinds exchanged between a host, a parser worker, and a chart document. */
export const CHART_FRAME = {
  header: 1,
  index: 2,
  line: 3,
  lines: 4,
  effects: 5,
  block: 6,
  end: 7,
  error: 8,
} as const;
export type ChartFrameKind = (typeof CHART_FRAME)[keyof typeof CHART_FRAME];

/** Line flags used by paged rendering, conversion, and diagnostics. */
export const LINE_FLAG_INVALID = 1 << 0;
/** The line has no finite end: it can affect any time after its known range. */
export const LINE_FLAG_UNBOUNDED = 1 << 1;
/** The line has no notes or events and is a static chart object. */
export const LINE_FLAG_STATIC = 1 << 2;
/** The line carries shader paint events. */
export const LINE_FLAG_SHADER = 1 << 3;
/** The line carries editor-only noise settings. */
export const LINE_FLAG_NOISE = 1 << 4;
/** The line needs the current-format conversion pass. */
export const LINE_FLAG_CONVERT = 1 << 5;
/** Every id-bearing object on the line already has a valid unique id. */
export const LINE_FLAG_IDS = 1 << 6;

/** The non-line part of a chart, sufficient to build a tempo map and surfaces. */
export interface ChartHeader {
  readonly META: ChartMeta;
  readonly BPMList: BpmEntry[];
  readonly judgeLineGroup?: string[];
  readonly blockAreaList?: BlockArea[];
  readonly effects?: unknown[];
  readonly shaderEvents?: unknown[];
  readonly markers?: unknown[];
  /** Unknown top-level fields preserved for round trips. */
  readonly extras: Record<string, unknown>;
  readonly lineCount: number;
}

/** One closed time interval in chart seconds. */
export type ChartTimeInterval = readonly [start: number, end: number];

/** A line's index entry; it never contains note or event objects. */
export interface ChartLineSummary {
  readonly index: number;
  /** Source-relative offset; the unit is the source's own (UTF-16 or bytes). */
  readonly byteOffset: number;
  /** Source-relative length; the unit is the source's own. */
  readonly byteLength: number;
  readonly noteCount: number;
  readonly eventCount: number;
  /** Earliest line time in seconds, or null when the line has no lower bound. */
  readonly startSeconds: number | null;
  /** Latest line time in seconds, or null when the line has no upper bound. */
  readonly endSeconds: number | null;
  /** Disjoint activity intervals used by paged time windows. */
  readonly intervals?: readonly ChartTimeInterval[];
  /** Content digest that ignores editor-only object ids. */
  readonly digest: string;
  /** Hashes of unchanged top-level children used to update a materialized line incrementally. */
  readonly childDigests?: Readonly<Record<string, number>>;
  readonly flags: number;
  readonly group: number;
  readonly father: number;
  readonly id?: string;
}

/** The complete line index for one chart source. */
export interface ChartIndex {
  readonly version: 1;
  readonly headerDigest: string;
  readonly lines: readonly ChartLineSummary[];
  readonly assetNames: readonly string[];
  readonly totalBytes: number;
  /** True when clean line text is already in the canonical serializer shape. */
  readonly canonical: boolean;
  /** True while semantic line digests are being filled by the background indexer. */
  readonly fingerprintsPending?: boolean;
}

/** One line range inside a JSON source. */
export interface ChartLineRange {
  readonly start: number;
  readonly end: number;
}

/** One line chunk emitted by a source or a parser. */
export interface ChartLineChunk {
  readonly start: number;
  readonly lines: readonly unknown[];
  readonly bytes: number;
}

/** A source that can produce a chart stream and, when indexed, random lines. */
export interface ChartSource {
  readonly kind: "native" | "library" | "memory";
  readonly name: string;
  readonly byteLength?: number;
  open(signal?: AbortSignal): Promise<ChartStream>;
}

/** A chart stream's header, index, and line frames. */
export interface ChartStream {
  readonly header: Promise<ChartHeader>;
  readonly index: Promise<ChartIndex | null>;
  lines(start: number, count: number, signal?: AbortSignal): AsyncIterable<ChartLineChunk>;
  effects?(signal?: AbortSignal): AsyncIterable<unknown[]>;
  close(): Promise<void>;
}

/** A provider that returns raw JSON text for one line. */
export interface ChartLineProvider {
  readonly lineCount: number;
  readLine(index: number, signal?: AbortSignal): Promise<string | ChartLineRead | undefined>;
}

/** Raw line text plus optional object hashes from an off-thread parser. */
export interface ChartLineRead {
  readonly raw: string;
  readonly valueDigests?: readonly ChartValueDigestGroup[];
}

/** A materialized chart plus the index that describes its source. */
export interface ChartDocumentSnapshot {
  readonly chart: Chart;
  readonly header: ChartHeader;
  readonly index: ChartIndex | null;
  readonly lines: readonly JudgeLine[];
}

/** A single binary frame before its payload is interpreted. */
export interface ChartFrame {
  readonly kind: ChartFrameKind;
  readonly payload: Uint8Array;
}

/** A line frame with its logical index and raw JSON payload. */
export interface ChartLineFrame {
  readonly index: number;
  readonly payload: Uint8Array;
}
