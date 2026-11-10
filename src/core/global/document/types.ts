/**
 * Shared document-layer types.
 *
 * `AssetMap` is the lazy asset contract, `OpenCandidate` a validated chart ready
 * to open, and `EditorCandidate` the pre-validation shape handed to the editor.
 */
import { type Chart } from "../chart/chart.ts";
import type { ChartDocument } from "../chart/streaming/chartDocument.ts";
import type { ChartDiagnostic } from "../chart/diagnostics.ts";
import type { LibraryProjectRef, LibraryViewState } from "../library/types.ts";

/**
 * Assets keyed by chart-relative path.
 *
 * Optional members expose names and bytes the map knows about but has not
 * loaded, which lets a large project open without reading every asset.
 */
export interface AssetMap extends Map<string, Uint8Array> {
  uri?(name: string): string;
  read?(name: string): Promise<Uint8Array | undefined>;
  /** Includes known paths whose bytes have not been loaded yet. */
  names?(): Iterable<string>;
}

/** A parsed chart ready to open, with its sidecar metadata and diagnostics. */
export interface OpenCandidate {
  name: string;
  chart: Chart;
  /** Paged document backing `chart`; its facade may contain placeholders. */
  chartDocument?: ChartDocument;
  /** Release a worker or source held only for this candidate. */
  disposeDocument?: () => void;
  info?: Record<string, string>;
  desktop?: boolean;
  project?: { assetFolders?: string[]; viewState?: LibraryViewState } | null;
  diagnostics?: readonly ChartDiagnostic[];
  readOnly?: boolean;
}

/** A chart candidate handed to the editor before chart validation and loading. */
export interface EditorCandidate {
  chart: unknown;
  /** Paged document backing `chart`; present when the source was streamed. */
  chartDocument?: ChartDocument;
  /** Release a worker or source held only for this candidate. */
  disposeDocument?: () => void;
  name: string;
  info?: Record<string, string>;
  desktop?: unknown;
  project?: LibraryProjectRef | null;
  diagnostics?: readonly ChartDiagnostic[];
  readOnly?: boolean;
}

/** Minimal chart metadata read from an unvalidated library response. */
export type UnvalidatedChart = { META?: { name?: unknown } };
