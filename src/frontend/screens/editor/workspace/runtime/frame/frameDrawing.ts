/**
 * Performs the drawing work of one editor frame and reports timing to the
 * optional frame probe. The render scheduler decides what is stale; timeline,
 * preview, and inspector owners perform their own painting.
 */
import type { AudioTransport } from "../../../../../../core/media/audio.ts";

import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import type { Timeline } from "../../timeline/surface/timeline.ts";
import type { TimelineOverview } from "../../timeline/overview/timelineOverview.ts";
import type { SelectionOverlay } from "../../timeline/selection/selectionOverlay.ts";
import type { MultiEditPanel } from "../../../inspector/multiEdit/multiEdit.ts";
import type { TrajectoryPanel } from "../../../inspector/trajectory/trajectoryPanel.ts";
import type { AudioAnalysis } from "../../timeline/audioAnalysis/audioAnalysis.ts";
import type { Preview } from "../../preview/scene/preview.ts";
import { selectionMapForSession } from "../../preview/interaction/previewSelection.ts";
import { EditorRenderScheduler, type RenderTiming } from "./renderScheduler.ts";
import { freeCameraState } from "../../stage/freeCamera/freeCamera.ts";
import { isPerformanceHudVisible } from "../../../../../overlays/performance/performanceHud.ts";
import { recordPerformanceFrameTiming } from "../../../../../overlays/performance/performanceFrameTiming.ts";

interface FrameTimingProbe {
  (sample: {
    now: number;
    timeline: boolean;
    preview: boolean;
    playhead: boolean;
    timelineMs: number;
    previewMs: number;
    totalMs: number;
    previewChartChanged: boolean;
    previewSessionChanged: boolean;
    previewSelectionChanged: boolean;
    previewSecondsChanged: boolean;
  }): void;
}

/** Forwards one frame timing sample to the optional global probe. */
function reportFrameTiming(sample: Parameters<FrameTimingProbe>[0]): void {
  const probe = (globalThis as typeof globalThis & { __reduxFrameTimingProbe?: FrameTimingProbe })
    .__reduxFrameTimingProbe;
  probe?.(sample);
  if (isPerformanceHudVisible()) {
    recordPerformanceFrameTiming({
      timelineMs: sample.timelineMs,
      previewMs: sample.previewMs,
      totalMs: sample.totalMs,
    });
  }
}

type FrameTimeline = Pick<Timeline, "draw" | "getSession" | "getPreviewSession"> & {
  renderRevision: number;
  drawPlayhead(playBeat: number): void;
  refreshRectangleSelection(): void;
  gestures: Pick<
    Timeline["gestures"],
    "drag" | "eventInteraction" | "previewMarquee" | "previewRefresh"
  >;
  viewport: Pick<Timeline["viewport"], "origin" | "setOrigin" | "setPlaybackActive">;
};

/** Services one editor frame paints through. */
export interface FrameDrawingOptions {
  audio: Pick<AudioTransport, "playing" | "duration">;
  /** True while a play request is still settling before audio reports playing. */
  playbackPending(): boolean;
  timeline: FrameTimeline;
  batchControls: { active: unknown; sync(): void };
  lineSwitcher: { active: boolean };
  multiEdit: Pick<MultiEditPanel, "drawTimeline" | "previewChart">;
  selectionOverlay: Pick<SelectionOverlay, "draw">;
  timelineOverview: Pick<TimelineOverview, "draw">;
  trajectoryPanel: Pick<TrajectoryPanel, "active" | "tick">;
  audioAnalysis: Pick<AudioAnalysis, "draw">;
  realtimePreview: Pick<Preview, "duration" | "visible" | "draw" | "invalidationRevision"> &
    Parameters<TrajectoryPanel["tick"]>[3];
  offsetSeconds(): number;
  updateLineInfo(): void;
  completeFirstRender(): void;
  /** Whether any authoring region currently shares the stage with the preview. */
  authoringRegionVisible(): boolean;
}
/** Keep canvas layer order and preview selection inside one drawing owner. */
export function createFrameDrawing(runtime: FrameDrawingOptions) {
  const renderScheduler = new EditorRenderScheduler();
  let densityChart: unknown = null;
  let previewHighDensity = false;
  let reducedQuality = false;
  let slowStreak = 0;
  let fastStreak = 0;
  let previousFrameTimestamp = Number.NaN;
  let previousPreviewChart: unknown;
  let previousPreviewSession: unknown;
  let previousPreviewSelection: unknown;
  let previousPreviewSeconds = Number.NaN;
  return {
    /** Whether a panel owns the frame even without a drag. */
    active: () => Boolean(runtime.trajectoryPanel.active),
    /** Whether a gesture or panel currently needs continuous frames. */
    interacting: () =>
      Boolean(
        runtime.timeline.gestures.drag ||
        runtime.timeline.gestures.eventInteraction.drag ||
        runtime.timeline.gestures.previewMarquee ||
        runtime.batchControls.active ||
        runtime.trajectoryPanel.active ||
        runtime.lineSwitcher.active,
      ),
    /**
     * Paints the frame at `frameSeconds` and returns the playhead beat.
     *
     * Layer order and preview selection are fixed here; callers cannot reorder
     * them.
     */
    draw(
      timestamp: number,
      frameSeconds: number,
      session: EditorSession,
      tempo: TempoMap,
      refreshHud: boolean,
      force: boolean = false,
      contentRefreshRate = 144,
    ): number {
      if (refreshHud) {
        runtime.batchControls.sync();
      }
      const beat = tempo.beat(frameSeconds, session.line?.bpmfactor ?? 1);
      session.editSeconds = Math.max(0, frameSeconds);
      if (refreshHud) {
        runtime.updateLineInfo();
      }
      const playbackActive = runtime.audio.playing || runtime.playbackPending();
      runtime.timeline.viewport.setPlaybackActive(playbackActive);
      if (runtime.audio.playing) {
        runtime.timeline.viewport.setOrigin(beat, "playback");
      }
      runtime.timeline.refreshRectangleSelection();
      runtime.timeline.gestures.previewRefresh?.();
      const marqueeActive =
        runtime.timeline.gestures.drag?.kind === "rectangle" ||
        runtime.timeline.gestures.eventInteraction.drag?.kind === "rectangle" ||
        Boolean(runtime.timeline.gestures.previewMarquee);
      runtime.realtimePreview.duration = runtime.audio.duration;
      const viewSession = runtime.timeline.getSession();
      const trajectoryView = runtime.trajectoryPanel.tick(
        timestamp,
        frameSeconds,
        runtime.audio.playing,
        runtime.realtimePreview,
      );
      const cameraPreview = freeCameraState.get().active;
      // One answer to "which chart is being previewed": the panel owns its own gate.
      const viewChart =
        trajectoryView?.chart ?? runtime.multiEdit.previewChart() ?? viewSession.chart;
      const viewSeconds = trajectoryView?.seconds ?? frameSeconds;
      const previewChartChanged = viewChart !== previousPreviewChart;
      const previewSession = runtime.timeline.getPreviewSession();
      const previewSelection = viewSession.selection;
      const previewSessionChanged = previewSession !== previousPreviewSession;
      const previewSelectionChanged = previewSelection !== previousPreviewSelection;
      const previewSecondsChanged = viewSeconds !== previousPreviewSeconds;
      previousPreviewChart = viewChart;
      previousPreviewSession = previewSession;
      previousPreviewSelection = previewSelection;
      previousPreviewSeconds = viewSeconds;
      if (densityChart !== viewChart) {
        const noteCount = (viewChart.judgeLineList ?? []).reduce(
          (total, line) => total + (line.notes?.length ?? 0),
          0,
        );
        densityChart = viewChart;
        previewHighDensity = noteCount > 5000;
      }
      const outcome = renderScheduler.tick(
        {
          now: timestamp,
          seconds: viewSeconds,
          playing: runtime.audio.playing,
          previewVisible:
            runtime.realtimePreview.visible || Boolean(trajectoryView) || cameraPreview,
          previewHighDensity,
          contentRefreshRate,
          previewMarqueeActive: Boolean(runtime.timeline.gestures.previewMarquee),
          reducedQuality,
          previewChart: viewChart,
          previewRevision: runtime.realtimePreview.invalidationRevision,
          // Resource-backed timeline layers (skins and overview density) can
          // change without changing the chart revision. The HUD cadence is a
          // bounded refresh path for those asynchronous visual changes.
          force: force || refreshHud || marqueeActive,
          timelineRevision: runtime.timeline.renderRevision,
          viewportOrigin: runtime.timeline.viewport.origin,
          previewSession,
          previewSelection,
          authoringRegionVisible: runtime.authoringRegionVisible(),
        },
        {
          paint: (request, work) => {
            const paintStarted = performance.now();
            let timelineMs: number | undefined;
            let previewMs: number | undefined;
            if (work.timeline) {
              const started = performance.now();
              runtime.timeline.draw(beat);
              // A batch drag owns the timeline proposal, so the inspector's
              // independent ghost layer is omitted while that preview is live.
              if (!runtime.timeline.getPreviewSession()) {
                runtime.multiEdit.drawTimeline();
              }
              runtime.audioAnalysis.draw(runtime.offsetSeconds());
              timelineMs = performance.now() - started;
            }
            // Keep the marquee canvas above the timeline content.
            runtime.selectionOverlay.draw();
            if (work.playhead) {
              runtime.timeline.drawPlayhead(beat);
              runtime.timelineOverview.draw(frameSeconds);
            }
            if (
              work.preview &&
              (runtime.realtimePreview.visible || trajectoryView || cameraPreview)
            ) {
              const started = performance.now();
              const visible = runtime.realtimePreview.visible;
              if (trajectoryView || cameraPreview) {
                runtime.realtimePreview.visible = true;
              }
              runtime.realtimePreview.draw(
                viewChart,
                tempo,
                viewSeconds,
                viewSession.lineIndex,
                selectionMapForSession(viewSession),
                {
                  maxHitEffects: work.maxHitEffects,
                  notePixelRatioScale: work.notePixelRatioScale,
                  deferHeavyFrame:
                    !runtime.audio.playing && previewHighDensity && !work.previewInvalidated,
                  selectedLines: viewSession.targetLineIndices,
                },
              );
              runtime.realtimePreview.visible = visible;
              previewMs = performance.now() - started;
            }
            reportFrameTiming({
              now: request.now,
              timeline: work.timeline,
              preview: work.preview,
              playhead: work.playhead,
              timelineMs: timelineMs ?? 0,
              previewMs: previewMs ?? 0,
              totalMs: performance.now() - paintStarted,
              previewChartChanged,
              previewSessionChanged,
              previewSelectionChanged,
              previewSecondsChanged,
            });
            return { timelineMs, previewMs } satisfies RenderTiming;
          },
        },
      );
      if (outcome.status === "failed") {
        renderScheduler.reset();
      }
      // Adaptive recovery removes cosmetic hit effects and lowers only the GPU
      // note layer's backing density. Logical note geometry, timeline, playhead,
      // blur, guides, and the Canvas fallback stay intact.
      const frameInterval = Number.isFinite(previousFrameTimestamp)
        ? timestamp - previousFrameTimestamp
        : 0;
      previousFrameTimestamp = timestamp;
      if (runtime.audio.playing && outcome.status !== "hidden") {
        const frameBudget = 1000 / Math.max(1, Math.min(144, contentRefreshRate));
        const missedDisplayDeadline = frameInterval > frameBudget * 1.35;
        if (outcome.renderMs > 14 || missedDisplayDeadline) {
          slowStreak += 1;
          fastStreak = 0;
        } else if (outcome.renderMs < 9 && !missedDisplayDeadline) {
          fastStreak += 1;
          slowStreak = 0;
        } else {
          slowStreak = 0;
          fastStreak = 0;
        }
        if (!reducedQuality && slowStreak >= 3) {
          reducedQuality = true;
        } else if (reducedQuality && fastStreak >= 90) {
          reducedQuality = false;
        }
      }
      runtime.completeFirstRender();

      return beat;
    },
  };
}
