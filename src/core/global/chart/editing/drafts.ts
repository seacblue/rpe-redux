/**
 * Pure chart transforms behind the metadata, BPM and offset editors.
 *
 * Each helper clones the chart, keeps an unchanged beat tuple verbatim, validates
 * through `assertChart`, and returns a new chart; draft text and commit timing stay
 * in the inspector.
 */
import { assertChart, type BpmEntry, type Chart } from "../chart.ts";
import { formatBeat, parseBeat } from "../timing/beat.ts";

/** BPM edits keep the original beat tuple when its displayed text was not changed. */
export interface BpmDraftValue {
  original: BpmEntry;
  time: string;
  bpm: string;
}

/** Apply non-timing metadata fields from draft text; `offset` is handled separately. */
export function chartWithMetadataDraft(
  chart: Chart,
  values: Readonly<Record<string, string>>,
): Chart {
  const metadata = { ...chart.META };
  for (const [key, value] of Object.entries(values)) {
    if (key !== "offset") {
      metadata[key] = value;
    }
  }
  const next = { ...chart, META: metadata };
  assertChart(next);
  return next;
}

/** Apply edited BPM rows, keeping each unchanged beat tuple verbatim. */
export function chartWithBpmDraft(chart: Chart, rows: readonly BpmDraftValue[]): Chart {
  const entries: BpmEntry[] = rows.map((row) => ({
    ...row.original,
    bpm: Number(row.bpm),
    startTime:
      row.time === formatBeat(row.original.startTime)
        ? row.original.startTime
        : parseBeat(row.time),
  }));
  const next = { ...chart, BPMList: entries };
  assertChart(next);
  return next;
}

/** Set the chart offset in milliseconds from draft text. */
export function chartWithOffsetDraft(chart: Chart, value: string): Chart {
  const next = { ...chart, META: { ...chart.META, offset: Number(value) } };
  assertChart(next);
  return next;
}

/** Replace the timing with one detected BPM and the beat-zero offset. */
export function chartWithDetectedTiming(chart: Chart, bpm: number, offsetMs: number): Chart {
  const next = {
    ...chart,
    BPMList: [{ bpm, startTime: [0, 0, 1] }],
    META: { ...chart.META, offset: offsetMs },
  };
  assertChart(next);
  return next;
}
