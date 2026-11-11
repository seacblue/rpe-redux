/**
 * The BPM pane: the selected timing point's attributes, the chart offset, a
 * playback-following metronome, and the BPM auto-detect entry, all reading the
 * shared BPM form request.
 *
 * The timing-point list lives on the global timing workspace; this pane only
 * edits the row selected there. The metronome is not a separate transport: it
 * swings and clicks from the live playback clock at the chart's current BPM.
 * The detector entry pins to the bottom of the pane in both modes.
 */
import type { ReactNode } from "react";
import {
  chartWithBpmDraft,
  chartWithOffsetDraft,
} from "../../../../../core/global/chart/editing/drafts.ts";
import { beatValue, formatBeat, type Beat } from "../../../../../core/global/chart/timing/beat.ts";
import { t } from "../../../../../i18n/index.ts";
import { InlineAlert } from "../../../../../design/components/alert/InlineAlert.tsx";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { FieldRows } from "../../../../../design/components/field/FieldRows.tsx";
import { Icon } from "../../../../../design/components/icon/Icon.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { InspectorEmpty } from "../InspectorEmpty.tsx";
import { BeatField } from "../beat/BeatField.tsx";
import type { BpmForm } from "./model.ts";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "../../../../../i18n/react.ts";
import {
  useEditorRuntime,
  useEditorRuntimeValue,
} from "../../workspace/runtime/composition/EditorRuntime.tsx";
import { documents } from "../../workspace/document/lifecycle/service.ts";
import {
  getTimingDetectionPending,
  openTimingDetection,
  subscribeTimingDetectionPending,
} from "../../workspace/timingDetection/timingDetectionState.ts";
import type { Chart } from "../../../../../core/global/chart/chart.ts";
import {
  clampTimingSelection,
  timingPointSelection,
} from "../../../global/sections/timing/timingSelection.ts";

/** Renders the selected timing point, or the chart offset when `mode` says so. */
export function BpmPanel({
  showTitle = true,
  mode = "point",
}: { showTitle?: boolean; mode?: "point" | "offset" } = {}) {
  const bpm = useEditorRuntimeValue((runtime) => runtime.ui.bpmForm, null);
  const { t } = useTranslation();
  const empty = <InspectorEmpty>{t("chrome.inspector.timing.empty")}</InspectorEmpty>;
  let content: ReactNode;
  if (mode === "offset") {
    content = bpm ? <BpmOffset session={bpm.session} chart={bpm.chart} /> : empty;
  } else {
    content = (
      <>
        {showTitle && <div className="panel-title">{t("chrome.pane.bpm")}</div>}
        {bpm && bpm.chart.BPMList.length ? (
          <>
            <BpmAttributes session={bpm.session} chart={bpm.chart} />
            <section className="bpm-tool bpm-tool-metronome">
              <h3 className="bpm-tool-title">{t("editorPanels.inspector.metronome.title")}</h3>
              <Metronome chart={bpm.chart} />
            </section>
          </>
        ) : (
          empty
        )}
      </>
    );
  }
  return (
    <div className="bpm-panel">
      {content}
      <TimingDetectFooter disabled={!bpm?.chart} />
    </div>
  );
}

/**
 * The auto-detect entry for the chart this pane edits.
 *
 * It starts the detector in manual mode and, while a new chart waits for its
 * first audio track, explains how to supply that track. `disabled` keeps the
 * entry inert when no chart is open; the pending hint still shows if a stale
 * request outlives the chart.
 */
export function TimingDetectFooter({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const runtime = useEditorRuntime();
  const pending = useSyncExternalStore(
    subscribeTimingDetectionPending,
    getTimingDetectionPending,
    getTimingDetectionPending,
  );
  const awaitingAudio = Boolean(
    pending && runtime && pending === runtime.getSession() && !runtime.audio.buffer,
  );
  return (
    <div className="bpm-detect">
      <Button
        type="button"
        variant="solid"
        block
        className="bpm-detect-action"
        disabled={disabled || !runtime}
        onClick={() => openTimingDetection("manual")}
      >
        <Icon name="bpm" size={16} />
        <span className="redux-button-label">{t("editorPanels.timingDetection.button")}</span>
      </Button>
      {awaitingAudio && (
        <InlineAlert
          tone="info"
          className="bpm-detect-pending"
          action={
            <Button type="button" variant="outlined" onClick={() => documents.pickMusic()}>
              {t("editorPanels.timingDetection.pendingPick")}
            </Button>
          }
        >
          {t("editorPanels.timingDetection.pendingHint")}
        </InlineAlert>
      )}
    </div>
  );
}

/** The BPM entry in force at a chart beat. */
function bpmAtBeat(entries: Chart["BPMList"], beat: number): number {
  let current = entries[0]?.bpm ?? 120;
  for (const entry of entries) {
    if (beatValue(entry.startTime) <= beat + 1e-9) {
      current = entry.bpm;
    } else {
      break;
    }
  }
  return current;
}

/** Formats a BPM readout without trailing zeroes. */
function metronomeLabel(bpm: number): string {
  return bpm.toFixed(2).replace(/\.?0+$/u, "");
}

/**
 * A real metronome: the pendulum follows the playback beat and the click is
 * generated only while audio is playing. It has no start or tap controls.
 */
function Metronome({ chart }: { chart: Chart }) {
  const { t } = useTranslation();
  const runtime = useEditorRuntime();
  const pendulum = useRef<SVGGElement>(null);
  const pulse = useRef<SVGCircleElement>(null);
  const audio = useRef<AudioContext | null>(null);
  const lastBeat = useRef<number | null>(null);
  const [bpm, setBpm] = useState(chart.BPMList[0]?.bpm ?? 120);

  useEffect(() => {
    const playback = runtime?.providers.playback;
    const tempo = runtime?.providers.session.tempo.get();
    if (!playback || !tempo) {
      return;
    }
    const entries = [...chart.BPMList].sort(
      (left, right) => beatValue(left.startTime) - beatValue(right.startTime),
    );
    let frame = 0;
    let disposed = false;

    const click = (beatIndex: number) => {
      try {
        // Playback already owns a running context after the user starts the
        // transport, so the click is audible without a second autoplay unlock.
        // A chart without a track falls back to a metronome-owned context.
        const transportContext = runtime?.providers.preview.audio.context ?? null;
        const context = transportContext ?? audio.current ?? new AudioContext();
        if (!transportContext) {
          audio.current = context;
        }
        if (context.state === "suspended") {
          void context.resume().catch(() => {});
        }
        const now = context.currentTime;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = beatIndex % 4 === 0 ? 1320 : 880;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.16, now + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.08);
        beatPulse(pulse.current);
      } catch {
        // Audio may be unavailable or blocked; the pendulum still follows the beat.
      }
    };

    const tick = () => {
      if (disposed) {
        return;
      }
      const playing = playback.playback.audio.playing;
      const beat = (() => {
        try {
          return tempo.beat(playback.chartSeconds(), 1);
        } catch {
          return 0;
        }
      })();
      const currentBpm = bpmAtBeat(entries, beat);
      setBpm((previous) => (Math.abs(previous - currentBpm) > 0.005 ? currentBpm : previous));

      if (pendulum.current) {
        pendulum.current.style.transition = playing ? "none" : "transform 240ms ease";
        const angle = playing ? Math.sin((beat + 0.5) * Math.PI) * 13 : 0;
        pendulum.current.style.transform = `rotate(${angle}deg)`;
      }

      if (playing) {
        const index = Math.floor(beat + 1e-9);
        // A seek or tempo edit can move the beat by more than one step; resync
        // silently, so playback never fires a burst of late clicks.
        if (lastBeat.current === null || index < lastBeat.current || index > lastBeat.current + 1) {
          lastBeat.current = index;
        } else if (index > lastBeat.current) {
          click(index);
          lastBeat.current = index;
        }
      } else {
        lastBeat.current = null;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      // The transport owns its context; only close the fallback this pane made.
      void audio.current?.close();
      audio.current = null;
      lastBeat.current = null;
    };
  }, [chart, runtime]);

  return (
    <div className="bpm-metronome">
      <div
        className="bpm-metronome-stage"
        role="img"
        aria-label={t("editorPanels.inspector.metronome.title")}
      >
        <svg viewBox="0 0 160 190" aria-hidden="true">
          <path className="bpm-metronome-base" d="M8 164H152L160 184H0Z" />
          <path className="bpm-metronome-body" d="M48 10H112L142 164H18Z" />
          <path className="bpm-metronome-face" d="M56 22H104L124 156H36Z" />
          <g className="bpm-metronome-scale">
            <line x1="48" y1="100" x2="54" y2="100" />
            <line x1="106" y1="100" x2="112" y2="100" />
            <line x1="45" y1="120" x2="51" y2="120" />
            <line x1="109" y1="120" x2="115" y2="120" />
            <line x1="42" y1="140" x2="48" y2="140" />
            <line x1="112" y1="140" x2="118" y2="140" />
          </g>
          <g ref={pendulum} className="bpm-metronome-pendulum">
            <rect x="77" y="26" width="6" height="130" rx="3" />
            <rect x="68" y="50" width="24" height="34" rx="6" />
          </g>
          <circle className="bpm-metronome-pivot" cx="80" cy="160" r="8" />
          <circle ref={pulse} className="bpm-metronome-pulse" cx="80" cy="160" r="10" />
        </svg>
      </div>
      <div className="bpm-metronome-readout">
        <strong>
          {metronomeLabel(bpm)} <small>BPM</small>
        </strong>
        <span>{t("editorPanels.inspector.metronome.hint")}</span>
      </div>
    </div>
  );
}

/** A quick ring from the metronome pivot; the pendulum already carries the beat. */
function beatPulse(node: SVGCircleElement | null): void {
  if (!node || typeof node.animate !== "function") {
    return;
  }
  node.animate(
    [
      { opacity: 0.85, transform: "scale(1)" },
      { opacity: 0, transform: "scale(2.4)" },
    ],
    { duration: 280, easing: "ease-out" },
  );
}

/**
 * Attributes for the timing point selected in the workspace.
 *
 * The list lives on the left; this panel only edits the current row, which is
 * the same split an osu! timing screen uses. Both fields commit on blur.
 */
function BpmAttributes({ session, chart }: Pick<BpmForm, "session" | "chart">) {
  const { t } = useTranslation();
  const selected = useSyncExternalStore(
    timingPointSelection.subscribe,
    timingPointSelection.get,
    timingPointSelection.get,
  );
  const index = Math.max(0, Math.min(selected, Math.max(0, chart.BPMList.length - 1)));
  useEffect(() => {
    clampTimingSelection(chart.BPMList.length);
  }, [chart.BPMList.length]);
  const entry = chart.BPMList[index];
  const [draft, setDraft] = useState(() => ({
    source: entry,
    bpm: entry ? String(entry.bpm) : "",
  }));
  const [error, setError] = useState("");
  const bpm = draft.source === entry ? draft.bpm : entry ? String(entry.bpm) : "";
  if (draft.source !== entry) {
    setDraft({
      source: entry,
      bpm: entry ? String(entry.bpm) : "",
    });
    setError("");
  }
  if (!entry) {
    return <InspectorEmpty>{t("chrome.inspector.timing.empty")}</InspectorEmpty>;
  }
  const bpmRows = (nextBpm: string) =>
    chart.BPMList.map((item, current) => ({
      original: item,
      time: formatBeat(item.startTime),
      bpm: current === index ? nextBpm : String(item.bpm),
    }));
  const commitBpm = (rows: ReturnType<typeof bpmRows>, label: string): void => {
    session.commitChart(
      label,
      chartWithBpmDraft(chart, rows),
      session.selectionState(),
      undefined,
      { normalized: true },
    );
  };
  const applyTime = (beat: Beat): boolean => {
    try {
      commitBpm(
        chart.BPMList.map((item, current) => ({
          original: item,
          time: current === index ? formatBeat(beat) : formatBeat(item.startTime),
          bpm: String(item.bpm),
        })),
        t("editorPanels.inspector.form.bpm.title"),
      );
      setError("");
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    }
  };
  const applyBpm = () => {
    try {
      commitBpm(bpmRows(bpm), t("editorPanels.inspector.form.bpm.title"));
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <div className="bpm-attributes">
      <div className="bpm-attributes-head">
        <span>{t("editorPanels.inspector.form.bpm.attributes")}</span>
      </div>
      <FieldRows>
        <FieldRow
          layout="inline"
          label={t("editorPanels.inspector.form.bpm.time")}
          control={(id) => (
            <BeatField
              id={id}
              value={entry.startTime}
              onCommit={applyTime}
              className="bpm-attribute-beat"
              dataField="bpm-time"
            />
          )}
        />
        <FieldRow
          layout="inline"
          density="compact"
          htmlFor="bpm-attribute-value"
          label={t("editorPanels.inspector.form.bpm.value")}
          control={
            <Input
              id="bpm-attribute-value"
              type="number"
              step="any"
              value={bpm}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraft({ source: entry, bpm: value });
              }}
              onBlur={applyBpm}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          }
        />
      </FieldRows>
      {error && <InlineAlert className="bpm-error">{error}</InlineAlert>}
    </div>
  );
}

/**
 * Timing offset lives above the BPM list because it applies to the whole chart,
 * not to one entry. It commits as soon as the field is left, so the panel has no
 * apply button of its own.
 */
function BpmOffset({ session, chart }: Pick<BpmForm, "session" | "chart">) {
  const editorRuntime = useEditorRuntime();
  const source = chart.META;
  const [draft, setDraft] = useState(() => ({ source, value: String(source.offset ?? 0) }));
  const [error, setError] = useState("");
  const value = draft.source === source ? draft.value : String(source.offset ?? 0);
  if (draft.source !== source) {
    setDraft({ source, value: String(source.offset ?? 0) });
    setError("");
  }
  const apply = (nextValue = value) => {
    if (nextValue === String(source.offset ?? 0)) {
      setError("");
      return;
    }
    try {
      const runtime = editorRuntime;
      const previousOffset = Number(source.offset ?? 0) / 1000;
      const chartSeconds = runtime ? runtime.audio.time - previousOffset : null;
      const next = chartWithOffsetDraft(session.chart, nextValue);
      session.commitChart(
        t("editorPanels.inspector.form.bpm.offsetCommit"),
        next,
        session.selectionState(),
        undefined,
        { normalized: true },
      );
      // Offset aligns the audio track with the chart. Keep the chart position
      // fixed while moving the audio clock, so the playhead line does not jump
      // when the author tunes the offset.
      if (runtime && chartSeconds !== null) {
        const nextOffset = Number(next.META.offset ?? 0) / 1000;
        runtime.audio.seek(chartSeconds + nextOffset);
      }
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <div className="bpm-offset-row">
      <FieldRow
        layout="inline"
        density="compact"
        htmlFor="bpm-offset"
        label={t("editorPanels.inspector.form.bpm.offset")}
        control={
          <Input
            id="bpm-offset"
            type="number"
            step="any"
            value={value}
            aria-invalid={Boolean(error)}
            onChange={(event) => setDraft({ source, value: event.currentTarget.value })}
            onBlur={() => apply()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
        }
      />
      {error && <InlineAlert className="bpm-offset-error">{error}</InlineAlert>}
    </div>
  );
}
