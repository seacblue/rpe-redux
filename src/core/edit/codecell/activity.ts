/**
 * The in-memory request log behind the AI activity pane.
 *
 * The desktop bridge records every Code Cell request an AI client receives an answer for,
 * so the user can inspect the method, timestamp, duration, request body, and
 * response body after the fact. Entries are newest first, frozen, and bounded
 * by both a count and a character budget; the log is session state and is never
 * written to preferences or the document.
 */
import { isRecord } from "../../utils/guards.ts";

const DEFAULT_LIMIT = 200;
const DEFAULT_BUDGET = 4 * 1024 * 1024;

/** Whether a recorded request is running, succeeded, or failed. */
export type CodeCellActivityStatus = "pending" | "ok" | "error";

/** One bridge request and, once answered, its response. */
export interface CodeCellActivityEntry {
  /** Stable per-log id so the view can key rows and locate pending work. */
  readonly id: string;
  /** Epoch milliseconds when the bridge accepted the frame. */
  readonly at: number;
  /** The JSON-RPC method, or `(unknown)` for a malformed frame. */
  readonly method: string;
  /** The complete request object as the client sent it. */
  readonly request: unknown;
  readonly status: CodeCellActivityStatus;
  /** Present once the request settles. */
  readonly response?: unknown;
  readonly durationMs?: number;
}

/** Settles one started entry with the response the bridge produced. */
export interface CodeCellActivityHandle {
  finish(response: unknown): void;
}

/** Retention and clock settings accepted by one log. */
export interface CodeCellActivityLogOptions {
  /** Maximum retained entries; defaults to 200. */
  limit?: number;
  /** Approximate retained JSON characters; defaults to 4 MiB. */
  budget?: number;
  /** Clock seam for tests; defaults to `Date.now`. */
  now?: () => number;
}

/** Reads the method from a request frame without trusting its shape. */
function methodOf(request: unknown): string {
  return isRecord(request) && typeof request.method === "string" && request.method.trim()
    ? request.method
    : "(unknown)";
}

/** Maps one response envelope onto the row status. */
function statusOf(method: string, response: unknown): CodeCellActivityStatus {
  if (!isRecord(response) || response.ok !== true) {
    return "error";
  }
  if ((method === "cell.run" || method === "code.run") && isRecord(response.value)) {
    return response.value.ok === false ? "error" : "ok";
  }
  return "ok";
}

/** Serialized size used only for the retention budget. */
function sizeOf(value: unknown): number {
  if (value === undefined) {
    return 0;
  }
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Approximate retained characters for one entry. */
function entrySize(entry: CodeCellActivityEntry): number {
  return sizeOf(entry.request) + sizeOf(entry.response) + entry.method.length + 32;
}

/**
 * Keeps the newest entries while both the count and the character budget allow.
 *
 * The input is newest first, so trimming the tail drops the oldest work without
 * reordering the list the pane renders.
 */
function trim(
  entries: readonly CodeCellActivityEntry[],
  limit: number,
  budget: number,
): readonly CodeCellActivityEntry[] {
  const kept: CodeCellActivityEntry[] = [];
  let total = 0;
  for (const entry of entries) {
    if (kept.length >= limit) {
      break;
    }
    const size = entrySize(entry);
    if (kept.length > 0 && total + size > budget) {
      break;
    }
    kept.push(entry);
    total += size;
  }
  return kept.length === entries.length ? entries : Object.freeze(kept);
}

/** Observable, bounded log of AI bridge requests. */
export class CodeCellActivityLog {
  private readonly limit: number;
  private readonly budget: number;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  private entries: readonly CodeCellActivityEntry[] = Object.freeze([]);
  private sequence = 0;

  /** Build a log with the given retention bounds and clock. */
  constructor(options: CodeCellActivityLogOptions = {}) {
    this.limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
    this.budget = Math.max(1, options.budget ?? DEFAULT_BUDGET);
    this.now = options.now ?? Date.now;
  }

  /** Observe new, settled, or cleared entries. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The current list, newest first. */
  get(): readonly CodeCellActivityEntry[] {
    return this.entries;
  }

  /** Drop every retained entry; pending handles still settle without reviving them. */
  clear(): void {
    if (!this.entries.length) {
      return;
    }
    this.entries = Object.freeze([]);
    this.publish();
  }

  /** Start one entry; the returned handle records the response and duration. */
  begin(request: unknown): CodeCellActivityHandle {
    const id = `activity-${++this.sequence}`;
    const at = this.now();
    const method = methodOf(request);
    const entry: CodeCellActivityEntry = Object.freeze({
      id,
      at,
      method,
      request,
      status: "pending",
    });
    this.entries = trim(Object.freeze([entry, ...this.entries]), this.limit, this.budget);
    this.publish();
    let settled = false;
    return Object.freeze({
      finish: (response: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        const index = this.entries.findIndex((current) => current.id === id);
        if (index === -1) {
          return;
        }
        const settledEntry: CodeCellActivityEntry = Object.freeze({
          ...entry,
          status: statusOf(method, response),
          response,
          durationMs: Math.max(0, this.now() - at),
        });
        this.entries = trim(
          Object.freeze(
            this.entries.map((current, position) => (position === index ? settledEntry : current)),
          ),
          this.limit,
          this.budget,
        );
        this.publish();
      },
    });
  }

  /** Notify subscribers over a copy so unsubscribing during a pass is safe. */
  private publish(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

/** The application-wide log; the desktop bridge writes and the pane reads. */
export const codeCellActivity = new CodeCellActivityLog();
