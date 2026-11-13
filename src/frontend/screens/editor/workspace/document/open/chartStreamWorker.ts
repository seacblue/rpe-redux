/**
 * Worker entry for chart streaming: scans one JSON source, builds the line
 * index off the UI thread, and serves raw line slices on demand. It never keeps
 * a parsed chart object graph.
 */
import { scanChartJson } from "../../../../../../core/global/chart/streaming/chartJsonScanner.ts";
import {
  buildChartIndex,
  chartHeaderFromScan,
} from "../../../../../../core/global/chart/streaming/chartLineSummary.ts";
import { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import {
  lineContentFingerprintParts,
  lineRevisionSeedFromJson,
} from "../../../../../../core/global/chart/chartContentHash.ts";
import { yieldToHost } from "../../../../../../core/utils/yieldToHost.ts";
import type {
  ChartWorkerRequest,
  ChartWorkerResponse,
} from "../../../../../../core/global/chart/streaming/chartStreamWorkerProtocol.ts";
import type { ChartLineRange } from "../../../../../../core/global/chart/streaming/chartStreamTypes.ts";
import type { ChartValueDigestGroup } from "../../../../../../core/global/chart/chartContentHash.ts";

interface StreamSession {
  readonly id: number;
  readonly text: string;
  readonly ranges: readonly ChartLineRange[];
}

/** Worker scope typed for the stream request/response protocol. */
const workerScope = globalThis as typeof globalThis & {
  onmessage: ((event: MessageEvent<ChartWorkerRequest>) => void) | null;
  postMessage(message: ChartWorkerResponse): void;
  close(): void;
};

let session: StreamSession | null = null;
let pendingChunks: Uint8Array[] = [];
let pendingBytes = 0;
/** Match the native document host's chart ceiling. */
const MAX_STREAM_BYTES = 512 * 1024 * 1024;

/** Send one worker response. */
function reply(message: ChartWorkerResponse): void {
  workerScope.postMessage(message);
}

/** Open one source and publish its header and index. */
function openSource(request: Extract<ChartWorkerRequest, { kind: "open" }>): void {
  pendingChunks = [];
  pendingBytes = 0;
  if (request.bytes) {
    pendingChunks.push(new Uint8Array(request.bytes));
    pendingBytes = request.bytes.byteLength;
  }
}

/** Compute semantic line seeds after the lightweight index is published. */
async function fingerprintSource(
  id: number,
  text: string,
  ranges: readonly ChartLineRange[],
): Promise<void> {
  const batchSize = 8;
  for (let start = 0; start < ranges.length; start += batchSize) {
    const seeds = [];
    for (let index = start; index < Math.min(ranges.length, start + batchSize); index += 1) {
      const range = ranges[index];
      seeds.push(lineRevisionSeedFromJson(text.slice(range.start, range.end)));
    }
    reply({ id, kind: "fingerprints", start, seeds });
    await yieldToHost();
  }
  reply({ id, kind: "fingerprints-done" });
}

/** Concatenate the received chunks and publish a lightweight index first. */
async function finishSource(
  request: Extract<ChartWorkerRequest, { kind: "finish" }>,
): Promise<void> {
  try {
    const bytes = new Uint8Array(pendingBytes);
    let offset = 0;
    for (const chunk of pendingChunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    pendingChunks = [];
    pendingBytes = 0;
    const text = new TextDecoder().decode(bytes);
    const scan = scanChartJson(text);
    const header = chartHeaderFromScan(scan);
    const tempo = new TempoMap(
      header.BPMList.length ? header.BPMList : [{ bpm: 120, startTime: [0, 0, 1] }],
    );
    const index = buildChartIndex(scan, tempo, { includeFingerprints: false });
    session = { id: request.id, text, ranges: scan.lineRanges };
    reply({
      id: request.id,
      kind: "header",
      header: { ...header, lineCount: scan.lineRanges.length },
    });
    reply({ id: request.id, kind: "index", index });
    await fingerprintSource(request.id, text, scan.lineRanges);
  } catch (error) {
    session = null;
    reply({
      id: request.id,
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Serve one raw line slice. */
function readLine(request: Extract<ChartWorkerRequest, { kind: "line" }>): void {
  if (!session || session.id !== request.id) {
    reply({ id: request.id, kind: "line", index: request.index, raw: null });
    return;
  }
  const range = session.ranges[request.index];
  const raw = range ? session.text.slice(range.start, range.end) : null;
  let valueDigests: readonly ChartValueDigestGroup[] | undefined;
  if (raw) {
    try {
      const line = JSON.parse(raw);
      valueDigests = lineContentFingerprintParts(line, { includeValueDigests: true }).valueDigests;
    } catch {
      valueDigests = undefined;
    }
  }
  reply({
    id: request.id,
    kind: "line",
    index: request.index,
    raw,
    valueDigests,
  });
}

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.kind === "open") {
    openSource(request);
    return;
  }
  if (request.kind === "append") {
    const chunk = new Uint8Array(request.chunk);
    if (pendingBytes + chunk.length > MAX_STREAM_BYTES) {
      pendingChunks = [];
      pendingBytes = 0;
      reply({ id: request.id, kind: "error", message: "chart_too_large" });
      return;
    }
    pendingChunks.push(chunk);
    pendingBytes += chunk.length;
    return;
  }
  if (request.kind === "finish") {
    void finishSource(request);
    return;
  }
  if (request.kind === "line") {
    readLine(request);
    return;
  }
  session = null;
  pendingChunks = [];
  pendingBytes = 0;
  workerScope.close();
};
