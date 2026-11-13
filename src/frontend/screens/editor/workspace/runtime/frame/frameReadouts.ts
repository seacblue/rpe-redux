/**
 * Publishes frame-driven readouts: clocks, progress, the performance HUD, and
 * pointer-position values. The statusbar and HUD own their presentation; this
 * module routes the updates at the cadence selected by the frame runner.
 */
import type { AudioTransport } from "../../../../../../core/media/audio.ts";

import { upperBound } from "../../../../../../core/utils/search.ts";

import { editorPlaying } from "../../../../../../core/edit/state/publishedValues.ts";
import { t } from "../../../../../../i18n/index.ts";
import {
  progressPublishDue,
  setProgressSnapshot,
  type ProgressState,
} from "../../../../../chrome/transport/chartProgressState.ts";
import type { NotesInspectorState } from "../../../inspector/notes/model.ts";
import type { EditorEditClock } from "../../../../../../core/edit/state/editClock.ts";

import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import type { Timeline } from "../../timeline/surface/timeline.ts";

import type { EditorChartInfoPresenter } from "../../../../../chrome/statusbar/chartInfoPresenter.ts";
import { checkedNote } from "../../../../../../core/edit/timeline/model.ts";
import { dragAnchor } from "../../../../../../core/edit/timeline/dragPreview.ts";
import {
  isPerformanceHudVisible,
  publishPerformanceHudFrame,
} from "../../../../../overlays/performance/performanceHud.ts";

import type { EditorFrameState, FrameVisibility } from "./frame.ts";
/** Values the readouts need from the live editor. */
export interface FrameReadoutOptions {
  notes: NotesInspectorState;
  audio: Pick<AudioTransport, "playing" | "time">;
  editClock: Pick<EditorEditClock, "format">;
  chartInfoVisible(): boolean;
  chartInfoPresenter(): Pick<EditorChartInfoPresenter, "updateClock"> | undefined;
  chartSeconds(): number;
  timeline: Pick<Timeline, "movedNote"> & {
    gestures: Pick<Timeline["gestures"], "drag" | "cursor">;
    viewport: Pick<Timeline["viewport"], "positionAt" | "snappedBeat">;
  };
  progress: ProgressState;
}
/** Publish transport progress per painted frame and other readouts on request. */
export function createFrameReadouts(options: FrameReadoutOptions, visibility: FrameVisibility) {
  const runtime = options;
  let lastProgressAt = Number.NEGATIVE_INFINITY;
  return {
    /** Refreshes the chart-info clock at most twice a second while editing. */
    updateClock(
      timestamp: number,
      state: Pick<EditorFrameState, "lastInfoTick" | "measuredFps">,
    ): void {
      if (
        visibility.hasDocument() &&
        !visibility.atHome() &&
        timestamp - state.lastInfoTick > 500
      ) {
        const chartInfo = runtime.chartInfoPresenter();
        if (chartInfo && runtime.chartInfoVisible()) {
          chartInfo.updateClock(runtime.editClock.format());
        }
        state.lastInfoTick = timestamp;
      }
    },
    /** Publishes transport time, BPM, and beat for the progress surface. */
    publishProgress(
      timestamp: number,
      seconds: number,
      audioSeconds: number,
      tempo: TempoMap,
      beat: number,
    ): void {
      if (!progressPublishDue(timestamp, lastProgressAt, runtime.audio?.playing === true)) {
        return;
      }
      lastProgressAt = timestamp;
      const tempoPoint =
        tempo.points[Math.max(0, upperBound(tempo.points, beat, (point) => point.beat) - 1)];
      setProgressSnapshot(runtime.progress, {
        time: audioSeconds,
        duration: runtime.progress.snapshot.get().duration,
        chartTime: `${seconds.toFixed(3)} s`,
        bpm: t("chrome.transport.bpm", { value: (60 / tempoPoint.secondsPerBeat).toFixed(2) }),
        beat: t("chrome.transport.beat", { value: beat.toFixed(3) }),
      });
    },
    /** Publishes playback state and the dragged note's live position. */
    publish(
      timestamp: number,
      state: Pick<EditorFrameState, "lastHudPaint">,
      session: EditorSession,
    ): void {
      state.lastHudPaint = timestamp;
      editorPlaying.set(runtime.audio.playing);
      const draggedLineIndex = Number.isInteger(runtime.timeline.gestures.drag?.lineIndex)
        ? (runtime.timeline.gestures.drag?.lineIndex ?? session.lineIndex)
        : session.lineIndex;
      const draggedSource =
        session.chart.judgeLineList?.[draggedLineIndex]?.notes?.[
          dragAnchor(runtime.timeline.gestures.drag) ?? -1
        ];
      const draggedNote =
        ["move", "startTime", "endTime"].includes(runtime.timeline.gestures.drag?.kind ?? "") &&
        draggedSource
          ? runtime.timeline.movedNote(checkedNote(draggedSource))
          : null;
      runtime.notes.livePosition.set(draggedNote ? Number(draggedNote.positionX).toFixed(2) : null);
    },
    /** Reports the last frame's draw time to the performance HUD when visible. */
    performance(
      timestamp: number,
      start: number,
      state: Pick<EditorFrameState, "measuredFps">,
      targetRefreshRate: number,
    ): void {
      const drawTimeMs = performance.now() - start;
      if (isPerformanceHudVisible()) {
        publishPerformanceHudFrame({
          timestamp,
          fps: state.measuredFps,
          drawTimeMs,
          targetRefreshRate,
        });
      }
    },
  };
}
