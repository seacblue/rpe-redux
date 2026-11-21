/**
 * Worker entry for the chart issue scan.
 *
 * The main thread posts one chart header, the lines whose object identity
 * changed, then a finish. The worker keeps the previous scan's lines and starts
 * from them when the line count still matches, so a one-note edit re-clones one
 * line instead of the whole chart. Keeping that clone off the UI thread is the
 * reason this worker exists.
 */
import { scanChartIssues } from "../../../../../../core/edit/validation/chartIssueScan.ts";
import {
  chartIssueScanInput,
  type ChartIssueWorkerLine,
  type ChartIssueWorkerOptions,
  type ChartIssueWorkerReply,
  type ChartIssueWorkerRequest,
} from "../../../../../../core/edit/validation/chartIssueWorkerProtocol.ts";

/** One open scan, accumulating the lines that changed. */
interface WorkerJob {
  header: Record<string, unknown>;
  lines: unknown[];
  options: ChartIssueWorkerOptions;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<ChartIssueWorkerRequest>) => void) | null;
  postMessage(message: ChartIssueWorkerReply): void;
}

const worker = self as unknown as WorkerScope;
const jobs = new Map<number, WorkerJob>();
/** Lines retained from the newest completed scan, reused while the count matches. */
let retainedLines: unknown[] | null = null;

worker.onmessage = ({ data }) => {
  if (data.type === "cancel") {
    jobs.delete(data.id);
    return;
  }
  if (data.type === "start") {
    // A reused line keeps the retained object; the caller only posts the lines
    // whose identity changed, so an untouched line never crosses again.
    const lines =
      retainedLines && retainedLines.length === data.lineCount
        ? [...retainedLines]
        : new Array<unknown>(data.lineCount);
    jobs.set(data.id, { header: data.header, lines, options: data.options });
    return;
  }
  const job = jobs.get(data.id);
  if (!job) {
    return;
  }
  if (data.type === "line") {
    assignLine(job, data as ChartIssueWorkerLine);
    return;
  }
  jobs.delete(data.id);
  retainedLines = job.lines;
  const input = chartIssueScanInput(job.header, job.lines, job.options);
  const result = scanChartIssues(input);
  worker.postMessage({
    type: "result",
    id: data.id,
    issues: result.issues,
    densityPeak: result.densityPeak,
  });
};

/** Store one posted line, ignoring an index the scan no longer expects. */
function assignLine(job: WorkerJob, message: ChartIssueWorkerLine): void {
  if (message.index < 0 || message.index >= job.lines.length) {
    return;
  }
  job.lines[message.index] = message.line;
}
