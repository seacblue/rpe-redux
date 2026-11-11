/**
 * Timing workspace: the timing-point rows, the chart offset, and add/delete.
 *
 * Rows follow osu!'s timing screen: selecting one shows its attributes in the
 * inspector beside the list. The inspector also owns the BPM auto-detect entry.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "../../../../../i18n/react.ts";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { InlineAlert } from "../../../../../design/components/alert/InlineAlert.tsx";
import { EmptyState } from "../../../../../design/components/empty-state/EmptyState.tsx";
import { ListRow } from "../../../../../design/components/list/ListRow.tsx";
import { useListbox } from "../../../../../design/patterns/list/useListbox.ts";
import { Icon } from "../../../../../design/components/icon/Icon.tsx";
import { beatValue, formatBeat, fromNumber } from "../../../../../core/global/chart/timing/beat.ts";
import type { Chart } from "../../../../../core/global/chart/chart.ts";
import { useEditorRuntime } from "../../../editor/workspace/runtime/composition/EditorRuntime.tsx";
import { useGlobalChart } from "../../useGlobalChart.ts";
import {
  clampTimingSelection,
  timingInspectorTarget,
  timingPointSelection,
} from "./timingSelection.ts";
import { selectTimingPoint } from "./timingActions.ts";

/** Renders the timing-point list and the add/delete controls. */
export function GlobalTimingWorkspace({
  variant = "compact",
}: {
  variant?: "compact" | "studio";
} = {}) {
  const { t } = useTranslation();
  const chart = useGlobalChart();
  const runtime = useEditorRuntime();
  const [error, setError] = useState("");
  const selected = useSyncExternalStore(
    timingPointSelection.subscribe,
    timingPointSelection.get,
    timingPointSelection.get,
  );
  const target = useSyncExternalStore(
    timingInspectorTarget.subscribe,
    timingInspectorTarget.get,
    timingInspectorTarget.get,
  );
  const entries = useMemo(() => chart?.BPMList ?? [], [chart]);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLElement>());
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    clampTimingSelection(entries.length);
  }, [entries.length]);

  // Keep the selected timing point vertically centred. Playback changes the
  // selection at each tempo boundary; a click changes it directly.
  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const row = rowRefs.current.get(selected);
    if (!row) {
      return;
    }
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const top =
      list.scrollTop + rowRect.top - listRect.top - (list.clientHeight - rowRect.height) / 2;
    list.scrollTo({ top: Math.max(0, top), behavior: playing ? "smooth" : "auto" });
  }, [selected, playing, entries.length]);

  // While the transport runs, follow the last timing point it has passed. The
  // check is intentionally time-based rather than frame-based: this surface is
  // mounted for the whole global timing page and a 120 ms tick is enough to
  // keep the list and inspector in step with playback.
  useEffect(() => {
    const playback = runtime?.providers.playback;
    const tempo = runtime?.providers.session.tempo;
    if (!playback || !tempo || entries.length === 0) {
      return;
    }
    const timer = window.setInterval(() => {
      const active = playback.playback.audio.playing;
      setPlaying((current) => (current === active ? current : active));
      if (!active) {
        return;
      }
      const beat = tempo.get().beat(playback.chartSeconds(), 1);
      let index = 0;
      let best = Number.NEGATIVE_INFINITY;
      for (let current = 0; current < entries.length; current += 1) {
        const start = beatValue(entries[current].startTime);
        if (start <= beat + 1e-6 && start >= best) {
          best = start;
          index = current;
        }
      }
      if (timingPointSelection.get() !== index) {
        timingInspectorTarget.set("point");
        timingPointSelection.set(index);
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [runtime, entries]);

  /** Selects a timing point and moves the playhead to its chart time. */
  const selectPoint = (index: number): void => {
    selectTimingPoint(index, entries, chart, runtime);
  };
  const listbox = useListbox({
    count: entries.length,
    selected,
    onSelect: selectPoint,
    idPrefix: "global-timing-option",
  });

  /** Commits a changed timing list and keeps the selection on the requested row. */
  const commit = (next: Chart, label: string, index?: number): void => {
    const session = runtime?.getSession();
    if (!session || next === chart) {
      return;
    }
    if (index !== undefined) {
      timingPointSelection.set(Math.max(0, index));
    }
    session.commitChart(label, next, session.selectionState(), undefined, { normalized: true });
    setError("");
  };

  /** Adds a timing point at the grid-snapped playhead, including when one already sits there. */
  const addAtPlayhead = (): void => {
    if (!chart || !runtime) {
      return;
    }
    const playback = runtime.providers.playback;
    const tempo = runtime.providers.session.tempo.get();
    const division = runtime.timeline.viewport.division;
    const gridDivision = Math.max(1, Math.trunc(division || 1));
    const step = 1 / gridDivision;
    const snapped = Math.round(tempo.beat(playback.chartSeconds(), 1) / step) * step;
    let previous = entries[0];
    let previousBeat = Number.NEGATIVE_INFINITY;
    for (const entry of entries) {
      const start = beatValue(entry.startTime);
      if (start <= snapped + 1e-9 && start >= previousBeat) {
        previousBeat = start;
        previous = entry;
      }
    }
    const entry = { bpm: previous?.bpm ?? 120, startTime: fromNumber(snapped, gridDivision) };
    const next = [...entries, entry].sort(
      (left, right) => beatValue(left.startTime) - beatValue(right.startTime),
    );
    try {
      commit(
        { ...chart, BPMList: next },
        t("editorPanels.inspector.form.bpm.add"),
        next.indexOf(entry),
      );
      timingInspectorTarget.set("point");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  /** Deletes the selected timing point; the chart always keeps at least one. */
  const removeSelected = (): void => {
    if (!chart || entries.length <= 1) {
      return;
    }
    const index = Math.max(0, Math.min(selected, entries.length - 1));
    const next = entries.filter((unused, current) => current !== index);
    try {
      commit(
        { ...chart, BPMList: next },
        t("editorPanels.inspector.form.bpm.delete"),
        Math.min(index, next.length - 1),
      );
      timingInspectorTarget.set("point");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const offset = Number(chart?.META.offset ?? 0);
  return (
    <div className="global-timing-workspace" data-variant={variant}>
      <div className="global-timing-body">
        <ListRow
          as="button"
          type="button"
          selected={target === "offset"}
          className="global-timing-row global-timing-offset"
          aria-pressed={target === "offset"}
          onClick={() => timingInspectorTarget.set("offset")}
        >
          <span>{t("editorPanels.inspector.form.bpm.offset")}</span>
          <strong>
            {Number.isFinite(offset) ? offset : 0}{" "}
            {t("editorPanels.inspector.form.bpm.milliseconds")}
          </strong>
        </ListRow>
        <div className="global-timing-divider" role="separator" />
        {variant === "studio" && entries.length > 0 && (
          <div className="global-timing-columns" aria-hidden="true">
            <span>{t("editorPanels.inspector.form.bpm.time")}</span>
            <span>BPM</span>
            <span>{t("editorPanels.inspector.form.bpm.gap")}</span>
          </div>
        )}
        {entries.length ? (
          <div
            ref={listRef}
            className="global-timing-list"
            role="listbox"
            aria-label={t("editorPanels.inspector.form.bpm.title")}
            data-inline-shortcut-surface
            {...listbox.listProps}
          >
            {entries.map((entry, index) => {
              const previous = index > 0 ? entries[index - 1] : undefined;
              const gap = previous
                ? beatValue(entry.startTime) - beatValue(previous.startTime)
                : null;
              return (
                <ListRow
                  key={`${index}:${entry.startTime.join(":")}:${entry.bpm}`}
                  ref={(row) => {
                    if (row) {
                      rowRefs.current.set(index, row);
                    } else {
                      rowRefs.current.delete(index);
                    }
                  }}
                  selected={selected === index}
                  className="global-timing-row"
                  data-bpm-index={index}
                  {...listbox.optionProps(index)}
                >
                  <span className="global-timing-row-time">{formatBeat(entry.startTime)}</span>
                  <span className="global-timing-row-bpm">
                    {entry.bpm.toFixed(3).replace(/\.?0+$/u, "")}
                    <small>BPM</small>
                  </span>
                  {variant === "studio" && (
                    <span className="global-timing-row-gap">
                      {gap === null ? "—" : `+${gap.toFixed(3).replace(/\.?0+$/u, "")}`}
                    </span>
                  )}
                </ListRow>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon="bpm"
            title={t("chrome.global.timing.emptyTitle")}
            description={t("chrome.global.timing.empty")}
          />
        )}
      </div>
      {error && <InlineAlert className="global-timing-error">{error}</InlineAlert>}
      <div className="global-timing-footer redux-footer-bar redux-footer-bar-compact">
        <Button
          type="button"
          variant="solid"
          block
          disabled={!chart || !runtime}
          onClick={addAtPlayhead}
        >
          <Icon name="plus" size={14} />
          <span className="redux-button-label">{t("editorPanels.inspector.form.bpm.add")}</span>
        </Button>
        <div className="redux-footer-actions">
          <Button
            type="button"
            variant="danger"
            disabled={!chart || entries.length <= 1}
            data-tip-title={t("editorPanels.inspector.form.bpm.delete")}
            onClick={removeSelected}
          >
            <Icon name="trash" size={14} />
            <span className="redux-button-label">
              {t("editorPanels.inspector.form.bpm.delete")}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
