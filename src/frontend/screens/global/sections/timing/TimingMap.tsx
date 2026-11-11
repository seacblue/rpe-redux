/**
 * The expanded timing overview: timing points become contiguous BPM bands on a
 * chart-beat rail. It exists only in the timing workspace, where there is room
 * to show the whole map and jump between spans without losing the list.
 */
import { useSyncExternalStore } from "react";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { beatValue, formatBeat } from "../../../../../core/global/chart/timing/beat.ts";
import type { Chart } from "../../../../../core/global/chart/chart.ts";
import { useEditorRuntime } from "../../../editor/workspace/runtime/composition/EditorRuntime.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import { selectTimingPoint } from "./timingActions.ts";
import { timingPointSelection } from "./timingSelection.ts";

/** One clickable tempo band spanning from its point to the next one. */
export function TimingMap({ entries, chart }: { entries: Chart["BPMList"]; chart: Chart | null }) {
  const { t } = useTranslation();
  const runtime = useEditorRuntime();
  const selected = useSyncExternalStore(
    timingPointSelection.subscribe,
    timingPointSelection.get,
    timingPointSelection.get,
  );
  if (entries.length === 0) {
    return null;
  }
  const starts = entries.map((entry) => beatValue(entry.startTime));
  const first = Math.min(...starts);
  const last = Math.max(...starts);
  const tail = Math.max(4, (last - first) * 0.08);
  const end = last + tail;
  const range = Math.max(1, end - first);
  return (
    <section className="timing-map" aria-label={t("editorPanels.inspector.form.bpm.map")}>
      <h3 className="timing-map-title">
        {t("editorPanels.inspector.form.bpm.map")}
        <span>{t("editorPanels.inspector.form.bpm.mapHint")}</span>
      </h3>
      <div className="timing-map-track" role="group">
        {entries.map((entry, index) => {
          const start = starts[index] ?? first;
          const next = starts[index + 1] ?? end;
          const left = ((start - first) / range) * 100;
          const width = Math.max(0.6, ((next - start) / range) * 100);
          return (
            <Button
              key={`${index}:${entry.startTime.join(":")}:${entry.bpm}`}
              type="button"
              variant="plain"
              className={`timing-map-band${selected === index ? " is-selected" : ""}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              aria-pressed={selected === index}
              aria-label={t("editorPanels.inspector.form.bpm.mapBand", {
                beat: formatBeat(entry.startTime),
                bpm: entry.bpm,
              })}
              onClick={() => selectTimingPoint(index, entries, chart, runtime)}
            >
              <strong>{entry.bpm.toFixed(3).replace(/\.?0+$/u, "")}</strong>
              <small>{formatBeat(entry.startTime)}</small>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
