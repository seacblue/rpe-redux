/**
 * Merges eager chart-content bounds with the indexed bounds of a streamed
 * document, so chart.range() remains useful before every line is materialized.
 */
import { chartContentRange, type ChartContentRange } from "../../global/chart/chartRange.ts";
import type { Chart } from "../../global/chart/chart.ts";
import { TempoMap } from "../../global/chart/timing/tempo.ts";
import { registeredChartDocument } from "../../global/chart/streaming/chartDocumentRegistry.ts";

/** Merge indexed bounds so a streamed chart is not shortened to its loaded lines. */
export function chartRange(source: Chart | null): ChartContentRange {
  const range = chartContentRange(source);
  const summaries = source ? (registeredChartDocument(source)?.index?.lines ?? []) : [];
  const starts = summaries
    .map((summary) => summary.startSeconds)
    .filter((value): value is number => Number.isFinite(value));
  const ends = summaries
    .map((summary) => summary.endSeconds)
    .filter((value): value is number => Number.isFinite(value));
  const startSeconds = Math.min(
    ...(range.startSeconds === null ? [] : [range.startSeconds]),
    ...starts,
  );
  const endSeconds = Math.max(...(range.endSeconds === null ? [] : [range.endSeconds]), ...ends);
  if (!Number.isFinite(startSeconds) && !Number.isFinite(endSeconds)) {
    return range;
  }
  let startBeat = range.startBeat;
  let endBeat = range.endBeat;
  if (source) {
    try {
      const tempo = new TempoMap(source.BPMList);
      if (Number.isFinite(startSeconds)) {
        startBeat = Math.min(startBeat ?? Number.POSITIVE_INFINITY, tempo.beat(startSeconds));
      }
      if (Number.isFinite(endSeconds)) {
        endBeat = Math.max(endBeat ?? Number.NEGATIVE_INFINITY, tempo.beat(endSeconds));
      }
    } catch {
      // The beat fields remain the eagerly scanned values when timing is invalid.
    }
  }
  return {
    startBeat: Number.isFinite(startBeat) ? startBeat : null,
    endBeat: Number.isFinite(endBeat) ? endBeat : null,
    startSeconds: Number.isFinite(startSeconds) ? startSeconds : null,
    endSeconds: Number.isFinite(endSeconds) ? endSeconds : null,
  };
}
