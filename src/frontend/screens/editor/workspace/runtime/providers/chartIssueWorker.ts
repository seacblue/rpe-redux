/**
 * Main-thread client for the chart issue worker.
 *
 * The scan runs in a dedicated worker so an edit never pays for it on the frame
 * thread. The chart crosses in slices: one header message, then one judge line
 * per message, because a single structured clone of a hundred-thousand-note
 * chart is itself a long task. When workers are unavailable — the unit suite, an
 * older host — the same scan runs inline and the caller sees no difference.
 *
 * A newer request cancels the open one and supersedes its result, so a burst of
 * edits costs one scan of the newest chart rather than one scan per edit.
 */
import {
  scanChartIssues,
  type ChartIssueScanInput,
  type ChartIssueScanResult,
} from "../../../../../../core/edit/validation/chartIssueScan.ts";
import type { Chart } from "../../../../../../core/global/chart/chart.ts";
import {
  chartIssueWorkerOptions,
  type ChartIssueWorkerReply,
  type ChartIssueWorkerRequest,
} from "../../../../../../core/edit/validation/chartIssueWorkerProtocol.ts";
import { yieldToHost } from "../../../../../../core/utils/yieldToHost.ts";

/** How many lines to post before yielding the frame. */
const LINES_PER_TURN = 8;

/**
 * Return the indices whose object identity changed.
 *
 * A chart commit copies the line array but reuses every untouched line, so this
 * is the exact set of lines the worker has to re-clone.
 */
function changedIndices(previous: readonly unknown[], next: readonly unknown[]): readonly number[] {
  const changed: number[] = [];
  for (let index = 0; index < next.length; index += 1) {
    if (previous[index] !== next[index]) {
      changed.push(index);
    }
  }
  return changed;
}

/** One scan request awaiting its worker reply. */
interface PendingScan {
  /** The lines this request posted, recorded only once the worker accepted them. */
  lines: readonly unknown[];
  resolve(result: ChartIssueScanResult): void;
  reject(error: unknown): void;
}

/** Owns the worker, its request ids, and the slicing loop. */
export class ChartIssueWorkerClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, PendingScan>();
  private nextId = 1;
  /** The line objects the worker already holds, for the next diff. */
  private sentLines: readonly unknown[] | null = null;

  /** Run one scan; always resolves with a result, or throws for an inline failure. */
  async scan(input: ChartIssueScanInput): Promise<ChartIssueScanResult> {
    const worker = this.workerInstance();
    if (!worker) {
      return scanChartIssues(input);
    }
    const id = this.nextId++;
    const lines = (input.chart as Chart & { judgeLineList?: unknown[] }).judgeLineList;
    const scannedLines = Array.isArray(lines) ? lines : [];
    return new Promise<ChartIssueScanResult>((resolve, reject) => {
      this.pending.set(id, { lines: scannedLines, resolve, reject });
      void this.post(worker, id, input, scannedLines).catch((error) => {
        this.fail(id, error);
      });
    });
  }

  /** Forget the line cache, e.g. after the caller swapped in a full snapshot. */
  resetLines(): void {
    this.sentLines = null;
  }

  /** Terminate the worker and fail whatever still waits on it. */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.sentLines = null;
    for (const [id] of [...this.pending]) {
      this.pending.delete(id);
    }
  }

  /** Returns the shared worker, or null when the host has none. */
  private workerInstance(): Worker | null {
    if (this.worker) {
      return this.worker;
    }
    if (typeof Worker === "undefined") {
      return null;
    }
    try {
      const worker = new Worker(new URL("./chartIssue.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event: MessageEvent<ChartIssueWorkerReply>) => {
        const reply = event.data;
        if (reply?.type !== "result") {
          return;
        }
        const request = this.pending.get(reply.id);
        if (!request) {
          return;
        }
        this.pending.delete(reply.id);
        // The worker now holds this request's lines, so the next diff compares
        // against them rather than against an unconfirmed earlier send.
        this.sentLines = request.lines;
        request.resolve({ issues: reply.issues, densityPeak: reply.densityPeak });
      };
      worker.onerror = () => {
        // A failed module worker is retried on the next scan; whatever was in
        // flight runs inline so the caller still gets an answer.
        const pending = [...this.pending.values()];
        this.pending.clear();
        worker.terminate();
        if (this.worker === worker) {
          this.worker = null;
        }
        // The replacement worker starts empty, so the next scan re-sends every
        // line rather than assuming the old copy survived.
        this.sentLines = null;
        for (const request of pending) {
          request.reject(new Error("Chart issue worker failed"));
        }
      };
      this.worker = worker;
      // A fresh worker holds no lines; the previous identity cache is stale.
      this.sentLines = null;
      return worker;
    } catch {
      return null;
    }
  }

  /** Post one chart in slices, yielding between groups of lines. */
  private async post(
    worker: Worker,
    id: number,
    input: ChartIssueScanInput,
    lines: readonly unknown[],
  ): Promise<void> {
    const chart = input.chart as Chart & Record<string, unknown>;
    const { judgeLineList: _lines, ...header } = chart;
    // A commit reuses every untouched line object, so comparing identities
    // against the previous send is enough to find what an edit changed. The
    // worker keeps its own copy and starts from it while the count matches.
    const previous = this.sentLines;
    const reusable = previous !== null && previous.length === lines.length;
    const changed = reusable ? changedIndices(previous, lines) : null;
    const post = (message: ChartIssueWorkerRequest): void => {
      if (this.pending.has(id)) {
        worker.postMessage(message);
      }
    };
    post({
      type: "start",
      id,
      header,
      lineCount: lines.length,
      options: chartIssueWorkerOptions(input.options),
    });
    if (!changed) {
      for (let index = 0; index < lines.length; index += 1) {
        post({ type: "line", id, index, line: lines[index] });
        if ((index + 1) % LINES_PER_TURN === 0) {
          await yieldToHost();
        }
      }
    } else {
      for (let index = 0; index < changed.length; index += 1) {
        const lineIndex = changed[index];
        if (!this.pending.has(id)) {
          return;
        }
        post({ type: "line", id, index: lineIndex, line: lines[lineIndex] });
        if ((index + 1) % LINES_PER_TURN === 0) {
          await yieldToHost();
        }
      }
    }
    post({ type: "finish", id });
  }

  /** Drop one request; a late reply is ignored by the id check. */
  private fail(id: number, error: unknown): void {
    const request = this.pending.get(id);
    if (!request) {
      return;
    }
    this.pending.delete(id);
    request.reject(error);
  }
}
