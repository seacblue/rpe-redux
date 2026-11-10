/**
 * Worker entry for chart serialization: assembles line-by-line postings back
 * into one immutable snapshot and returns JSON text. A throw is left to the
 * main thread's fallback path, so this file keeps no recovery policy of its own.
 */
import { serializeChart } from "../../../../../../core/global/chart/chart.ts";

type SerializeMode = "chart" | "json";

interface SerializeStart {
  id: number;
  kind: "start";
  chart: Record<string, unknown>;
  lineCount: number;
  mode?: SerializeMode;
}

interface SerializeLine {
  id: number;
  kind: "line";
  index: number;
  line: unknown;
}

interface SerializeEnd {
  id: number;
  kind: "end";
}

interface SerializeWhole {
  id: number;
  kind: "whole";
  chart: unknown;
  mode?: SerializeMode;
}

type SerializeRequest = SerializeStart | SerializeLine | SerializeEnd | SerializeWhole;

interface SerializeJob {
  chart: Record<string, unknown>;
  lines: unknown[];
  mode: SerializeMode;
}

/** Per-request chart headers awaiting their line postings. */
const jobs = new Map<number, SerializeJob>();

self.onmessage = (event: MessageEvent<SerializeRequest>) => {
  const request = event.data;
  if (request.kind === "whole") {
    jobs.delete(request.id);
    const text =
      request.mode === "json" ? JSON.stringify(request.chart) : serializeChart(request.chart);
    self.postMessage({ id: request.id, text });
    return;
  }
  if (request.kind === "start") {
    jobs.set(request.id, {
      chart: request.chart,
      lines: new Array<unknown>(request.lineCount),
      mode: request.mode ?? "chart",
    });
    return;
  }
  const job = jobs.get(request.id);
  if (!job) {
    return;
  }
  if (request.kind === "line") {
    job.lines[request.index] = request.line;
    return;
  }
  jobs.delete(request.id);
  // Lines arrive separately so the UI thread never clones the full chart in one
  // task; rebuild the original shape before the serializer validates it.
  const chart = { ...job.chart, judgeLineList: job.lines };
  const text = job.mode === "json" ? JSON.stringify(chart) : serializeChart(chart);
  self.postMessage({ id: request.id, text });
};
