/**
 * Shared timing-row selection: move the inspector target, select the row, and
 * seek the playhead to that point.
 *
 * The compact list and the expanded timing map call the same function so a click
 * means the same edit context in both layouts.
 */
import type { Chart } from "../../../../../core/global/chart/chart.ts";
import { beatValue } from "../../../../../core/global/chart/timing/beat.ts";
import type { EditorRuntime } from "../../../editor/workspace/runtime/composition/EditorRuntime.tsx";
import { timingInspectorTarget, timingPointSelection } from "./timingSelection.ts";

/** Selects one timing point and pauses the transport at its chart time. */
export function selectTimingPoint(
  index: number,
  entries: Chart["BPMList"],
  chart: Chart | null,
  runtime: EditorRuntime | null,
): void {
  timingInspectorTarget.set("point");
  timingPointSelection.set(index);
  const entry = entries[index];
  if (!entry || !runtime) {
    return;
  }
  // Timing points are global beats, so the conversion deliberately uses factor 1
  // rather than the selected line's BPM factor.
  const tempo = runtime.providers.session.tempo.get();
  const offset = Number(chart?.META.offset ?? 0) / 1000;
  runtime.providers.playback.playback.seek(
    tempo.seconds(beatValue(entry.startTime), 1) + offset,
    true,
  );
}
