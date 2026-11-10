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

/** Attach the owning document to a chart facade. */
export function registerChartDocument(chart: object, document: RegisteredChartDocument): void {
  documents.set(chart, document);
}

/** Read the document that owns a chart facade, if any. */
export function registeredChartDocument(chart: object): RegisteredChartDocument | undefined {
  return documents.get(chart);
}
