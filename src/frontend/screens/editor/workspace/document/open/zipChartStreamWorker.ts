/**
 * Opens one chart entry inside the archive worker, then serves indexed line
 * slices without sending the decompressed JSON through the UI thread.
 */
import { readZip, type ZipLimits } from "../../../../../../core/utils/zip.ts";
import {
  buildChartIndex,
  chartHeaderFromScan,
} from "../../../../../../core/global/chart/streaming/chartLineSummary.ts";
import { scanChartJson } from "../../../../../../core/global/chart/streaming/chartJsonScanner.ts";
import { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import { lineRevisionSeedFromJson } from "../../../../../../core/global/chart/chartContentHash.ts";
import { yieldToHost } from "../../../../../../core/utils/yieldToHost.ts";
import type {
  ChartWorkerResponse,
  ChartWorkerRequest,
} from "../../../../../../core/global/chart/streaming/chartStreamWorkerProtocol.ts";
import type { ChartLineRange } from "../../../../../../core/global/chart/streaming/chartStreamTypes.ts";

type ArchiveChartRequest =
  | {
      readonly id: number;
      readonly kind: "open";
      readonly buffer: ArrayBuffer;
      readonly name: string;
      readonly limits: ZipLimits;
    }
  | Extract<ChartWorkerRequest, { kind: "line" | "fingerprints" | "close" }>;

interface ArchiveChartSession {
  readonly id: number;
  readonly text: string;
  readonly ranges: readonly ChartLineRange[];
}

const workerScope = globalThis as typeof globalThis & {
  onmessage: ((event: MessageEvent<ArchiveChartRequest>) => void) | null;
  postMessage(message: ChartWorkerResponse): void;
  close(): void;
};

let session: ArchiveChartSession | null = null;
let fingerprintsStarted = false;

/** Send one chart-stream response. */
function reply(message: ChartWorkerResponse): void {
  workerScope.postMessage(message);
}

/** Hydrate semantic line digests after the first frame can be opened. */
async function fingerprintSource(id: number, source: ArchiveChartSession): Promise<void> {
  for (let start = 0; start < source.ranges.length; start += 8) {
    const seeds = [];
    for (let index = start; index < Math.min(source.ranges.length, start + 8); index += 1) {
      const range = source.ranges[index];
      seeds.push(lineRevisionSeedFromJson(source.text.slice(range.start, range.end)));
    }
    reply({ id, kind: "fingerprints", start, seeds });
    await yieldToHost();
  }
  reply({ id, kind: "fingerprints-done" });
}

/** Open, decompress, scan, and index one archive chart entry. */
async function openArchiveChart(
  request: Extract<ArchiveChartRequest, { kind: "open" }>,
): Promise<void> {
  try {
    const files = await readZip(request.buffer, {
      ...request.limits,
      only: [request.name],
    });
    const bytes = files.get(request.name);
    if (!bytes) {
      throw new Error(`Chart entry is missing: ${request.name}`);
    }
    const text = new TextDecoder().decode(bytes);
    const scan = scanChartJson(text);
    if (!scan.keyOrder.includes("judgeLineList")) {
      throw new Error(`Archive entry is not an RPE chart: ${request.name}`);
    }
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
  } catch (error) {
    session = null;
    reply({
      id: request.id,
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Serve one indexed raw line. */
function readLine(request: Extract<ArchiveChartRequest, { kind: "line" }>): void {
  if (!session || session.id !== request.id) {
    reply({ id: request.id, kind: "line", index: request.index, raw: null });
    return;
  }
  const range = session.ranges[request.index];
  reply({
    id: request.id,
    kind: "line",
    index: request.index,
    raw: range ? session.text.slice(range.start, range.end) : null,
  });
}

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.kind === "open") {
    fingerprintsStarted = false;
    void openArchiveChart(request);
    return;
  }
  if (request.kind === "fingerprints") {
    if (!fingerprintsStarted && session && session.id === request.id) {
      fingerprintsStarted = true;
      void fingerprintSource(request.id, session);
    }
    return;
  }
  if (request.kind === "line") {
    readLine(request);
    return;
  }
  session = null;
  workerScope.close();
};
