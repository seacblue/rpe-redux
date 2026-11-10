/**
 * The contracts the desktop document host shares with TypeScript callers.
 *
 * Opened documents, streamed chart messages, save options, and recovery records
 * live here; the type-only module names no operations.
 */
import type { Chart } from "../chart/chart.ts";
import type { ChartDocument } from "../chart/streaming/chartDocument.ts";

import { type LoadTask } from "./loading.ts";
import type { AssetMap } from "./types.ts";
import type { LibraryViewState } from "../library/types.ts";
/** One asset name listed in an opened document's manifest. */
export interface AssetEntry {
  name: string;
}

/** Incremental chart payload streamed by the native host while opening. */
export type ChartStreamMessage =
  | { kind: "header"; chart: Record<string, unknown> }
  | { kind: "lines"; lines: unknown[] }
  | { kind: "done" };

/** Document metadata returned by the native host for an opened chart. */
export interface OpenedDocument {
  id: string;
  path: string;
  chart?: unknown;
  chart_name: string;
  packed?: boolean;
  disk_snapshot?: string;
  entries: AssetEntry[];
  assetFolders?: string[];
  viewState?: LibraryViewState;
  /**
   * References that stayed unloaded because they point outside the document
   * folder. The native host omits the key when every reference resolved.
   */
  rejected_external_resources?: string[];
}

/** Payload of the event reporting that a document's backing file changed. */
export interface DocumentDiskChangePayload {
  documentId: string;
}

/** Event name the host uses to report an on-disk change for an open document. */
export const DOCUMENT_DISK_CHANGE_EVENT = "redux-document-disk-change";

/** A chart selected for opening together with the document that will back it. */
export interface OpenedCandidate {
  chart: unknown;
  /** Paged document backing a streamed native open. */
  chartDocument?: ChartDocument;
  name: string;
  desktop: OpenedDocument;
  info?: Record<string, string>;
  project?: { assetFolders?: string[]; viewState?: LibraryViewState } | null;
}

/** An opened candidate plus its assets and the task tracking remaining load work. */
export interface OpenResult {
  candidate: OpenedCandidate;
  assets: AssetMap;
  task: LoadTask;
}

/** Result of a completed save or export. */
export interface SaveDocumentResult {
  status: "saved";
  /** Empty when the document was saved to the internal library. */
  path: string;
  /** Returned only when native path remapping changed chart references. */
  chart?: Chart;
  packed: boolean;
  chart_name: string;
  remap: Record<string, string>;
  disk_snapshot?: string | null;
  /** `library` is the normal save; native file writes are explicit exports. */
  storage?: "file" | "library";
  projectId?: string;
  revision?: number;
}

/** Save rejected because the file changed on disk since it was read. */
export interface SaveConflictResult {
  status: "save_conflict";
  path: string;
  expected_disk_snapshot: string | null;
  actual_disk_snapshot: string | null;
}

/** Union of a completed save and a detected disk conflict. */
export type SaveResult = SaveDocumentResult | SaveConflictResult;

/** Caller-controlled save target, format, and progress reporting. */
export interface SaveOptions {
  path?: string;
  format?: string;
  name?: string;
  export?: boolean;
  /** Optional 0..1 progress for long saves, including chart chunks and assets. */
  onProgress?: (value: number) => void;
}

/** Lightweight recovery record shown in the recovery list. */
export interface RecoverySummary {
  id: string;
  title?: string;
  path?: string;
  /** File modification time in Unix milliseconds, when the host can read it. */
  createdAt?: number;
}

/** Recovery record with the chart and view state needed to restore a session. */
export interface RecoveryDraft {
  id: string;
  path?: string;
  title?: string;
  chart?: unknown;
  viewState?: LibraryViewState;
  assets?: [string, number[]][];
}

/** Asset bytes transferred through the native save stream. */
export interface AssetUpdate {
  name: string;
  bytes: number[];
}

/** Bytes kept in the renderer until they are sent through the native save stream. */
export interface AssetChange {
  name: string;
  bytes: Uint8Array;
}
