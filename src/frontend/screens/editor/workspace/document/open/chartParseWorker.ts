/**
 * Worker entry for chart parsing: normalizes object ids and streams candidates
 * so the main thread never parses or fingerprints a large chart. Line digests
 * travel beside each batch and seed copy-on-write edits after structured clone.
 * The worker communicates only through messages and keeps no editor state.
 */
import { normalizeChartObjectIds } from "../../../../../../core/global/chart/chart.ts";
import { parseChartEntries } from "../../../../../../core/global/document/chartParsing.ts";
import { lineRevisionSeed } from "../../../../../../core/global/chart/chartContentHash.ts";
import { yieldToHost } from "../../../../../../core/utils/yieldToHost.ts";
import type { ChartParseRequest, ChartParseResponse } from "./chartParseProtocol.ts";

/** Judge lines sent in one structured-clone batch. */
const CHUNK_LINES = 12;

/** Worker scope typed for the parse request/response protocol. */
const workerScope = globalThis as typeof globalThis & {
  onmessage: ((event: MessageEvent<ChartParseRequest>) => void) | null;
  postMessage(message: ChartParseResponse): void;
};

/** Parses one request, then streams normalized candidate headers and line batches. */
workerScope.onmessage = (event) => {
  const entries: Array<{ name: string; bytes: ArrayBuffer }> = event.data.entries;
  void (async () => {
    const result = parseChartEntries(
      entries.map(({ name, bytes }) => [name, new Uint8Array(bytes)] as const),
    );
    const candidates = result.candidates.map((candidate) => {
      const chart = normalizeChartObjectIds(candidate.chart);
      return {
        name: candidate.name,
        chart: { ...chart, judgeLineList: [] },
        info: candidate.info,
        desktop: candidate.desktop,
        project: candidate.project,
        diagnostics: candidate.diagnostics,
        readOnly: candidate.readOnly,
        normalized: true,
      };
    });
    workerScope.postMessage({
      id: event.data.id,
      kind: "start",
      candidates,
      errors: result.errors,
      issues: result.issues,
    });
    for (let candidateIndex = 0; candidateIndex < result.candidates.length; candidateIndex++) {
      const lines = result.candidates[candidateIndex].chart.judgeLineList ?? [];
      for (let offset = 0; offset < lines.length; offset += CHUNK_LINES) {
        const batch = lines.slice(offset, offset + CHUNK_LINES);
        const revisionSeeds = batch.map((line) => lineRevisionSeed(line));
        workerScope.postMessage({
          id: event.data.id,
          kind: "lines",
          candidateIndex,
          lines: batch,
          revisionSeeds,
        });
        // Let the receiving document breathe between structured-clone batches.
        await yieldToHost();
      }
    }
    workerScope.postMessage({ id: event.data.id, kind: "done" });
  })();
};
