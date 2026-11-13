/**
 * Main-thread front end for the chart parsing worker: sends archive entries to
 * the worker and rebuilds candidates with their line revision seeds on return.
 * Parsing rules stay in core; hosts without workers parse in-process.
 */
import { markChartObjectIdsNormalized } from "../../../../../../core/global/chart/chart.ts";
import {
  parseChartEntries,
  type ParsedChartEntries,
} from "../../../../../../core/global/document/chartParsing.ts";
import type { OpenCandidate } from "../../../../../../core/global/document/types.ts";
import type { ChartLineRevisionSeed } from "../../../../../../core/global/chart/chartRevisionSeed.ts";
import { lineRevisionSeed } from "../../../../../../core/global/chart/chartContentHash.ts";
import type { ChartParseResponse } from "./chartParseProtocol.ts";

let nextRequestId = 1;

/** Attach seeds to a parsed result for hosts without a worker or after failure. */
function attachRevisionSeeds(parsed: ParsedChartEntries): ParsedChartEntries {
  for (const candidate of parsed.candidates) {
    candidate.revisionSeed = {
      lines: (candidate.chart.judgeLineList ?? []).map((line) => lineRevisionSeed(line)),
    };
  }
  return parsed;
}

/**
 * Parses chart JSON away from the UI thread when module workers are available.
 *
 * The worker returns the header first and then line batches, and the source
 * bytes are copied before transfer because the asset map stays with the session.
 */
export async function parseChartEntriesOffThread(
  entries: Iterable<[string, Uint8Array]>,
): Promise<ParsedChartEntries> {
  const jsonEntries = [...entries].filter(([name]) => /\.json$/i.test(name));
  if (!jsonEntries.length || typeof Worker === "undefined") {
    return attachRevisionSeeds(parseChartEntries(jsonEntries));
  }

  const worker = new Worker(new URL("./chartParseWorker.ts", import.meta.url), {
    type: "module",
  });
  const id = nextRequestId++;
  const payload = jsonEntries.map(([name, bytes]) => ({
    name,
    bytes: bytes.slice().buffer,
  }));
  const transfer = payload.map(({ bytes }) => bytes);
  return new Promise<ParsedChartEntries>((resolve) => {
    const candidates: OpenCandidate[] = [];
    const normalized: boolean[] = [];
    const revisionSeeds: ChartLineRevisionSeed[][] = [];
    let errors: string[] = [];
    let issues: ParsedChartEntries["issues"] = [];
    let settled = false;
    /** Terminates the worker and resolves the parse exactly once. */
    const finish = (result: ParsedChartEntries): void => {
      if (settled) {
        return;
      }
      settled = true;
      worker.terminate();
      resolve(result);
    };
    /** Completes the parse on the main thread after a worker failure. */
    const fallback = (): void => {
      finish(attachRevisionSeeds(parseChartEntries(jsonEntries)));
    };
    worker.onmessage = (event: MessageEvent<ChartParseResponse>) => {
      const message = event.data;
      if (message.id !== id) {
        return;
      }
      if (message.kind === "start") {
        for (const entry of message.candidates) {
          const { chart, normalized: entryNormalized, ...meta } = entry;
          candidates.push({ ...meta, chart: { ...chart, judgeLineList: [] } });
          normalized.push(entryNormalized);
          revisionSeeds.push([]);
        }
        errors = message.errors;
        issues = message.issues;
        return;
      }
      if (message.kind === "lines") {
        candidates[message.candidateIndex]?.chart.judgeLineList?.push(...message.lines);
        revisionSeeds[message.candidateIndex]?.push(...message.revisionSeeds);
        return;
      }
      for (let index = 0; index < candidates.length; index++) {
        if (normalized[index]) {
          markChartObjectIdsNormalized(candidates[index].chart);
        }
        candidates[index].revisionSeed = { lines: revisionSeeds[index] ?? [] };
      }
      finish({ candidates, errors, issues });
    };
    worker.onerror = () => fallback();
    worker.postMessage({ id, entries: payload }, transfer);
  });
}
