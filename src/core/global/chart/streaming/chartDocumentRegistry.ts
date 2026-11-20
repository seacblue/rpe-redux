/**
 * Registers document-backed chart facades so shared chart readers can find the
 * canonical fingerprint and materializer without importing the streaming layer.
 */
import type { Chart } from "../chart.ts";

/** The document operations a chart facade exposes to shared readers. */
export interface RegisteredChartDocument {
  /** Canonical content fingerprint for the facade. */
  fingerprint(): string;
  /** Materialize every line and return a plain chart snapshot. */
  materializeAll(): Promise<Chart>;
  /** Write the chart as JSON chunks when the source supports it. */
  serialize?(sink: (chunk: string) => Promise<void> | void): Promise<void>;
}

const documents = new WeakMap<object, RegisteredChartDocument>();
/**
 * The same documents keyed by their live `judgeLineList`.
 *
 * A snapshot is taken as `{ ...chart }` so a writer cannot mutate the live
 * document, and that copy is a different object from the facade. Every shallow
 * copy still shares the facade's line array, so this key recognizes a copy without
 * iterating the weak registry. Without it, a copied paged facade would serialize
 * its placeholder lines as if they were content and store an emptied chart.
 */
const documentsByLines = new WeakMap<object, RegisteredChartDocument>();

/** Attach the owning document to a chart facade and to its live line array. */
export function registerChartDocument(chart: object, document: RegisteredChartDocument): void {
  documents.set(chart, document);
  const lines = (chart as { judgeLineList?: unknown }).judgeLineList;
  if (lines && typeof lines === "object") {
    documentsByLines.set(lines as object, document);
  }
}

/** Read the document that owns a chart facade, or a shallow copy of one. */
export function registeredChartDocument(chart: object): RegisteredChartDocument | undefined {
  const direct = documents.get(chart);
  if (direct) {
    return direct;
  }
  const lines = (chart as { judgeLineList?: unknown }).judgeLineList;
  if (!lines || typeof lines !== "object") {
    return undefined;
  }
  return documentsByLines.get(lines as object);
}
