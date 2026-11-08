/** Owns transport, playback clocks, metrics, and the draft autosave lifecycle. */
import { createContext, useContext, type ReactNode } from "react";
import { showProgressToast } from "../../../../../../design/patterns/ToastHost.tsx";
import { AutoSaveClock } from "../../../../../../core/edit/session/autosave.ts";
import { EditorPlayback } from "../../../../../../core/edit/playback/transport.ts";
import { PlaybackMetrics } from "../../../../../../core/edit/perf/playbackMetrics.ts";
import { t } from "../../../../../../i18n/index.ts";
import { idleScheduler } from "../../document/save/idleScheduler.ts";
import type { AssetMap } from "../../../../../../core/global/document/types.ts";
import type { TauriDocumentStore } from "../../../../../../core/platform/desktop/documentStore.ts";
import type { Chart } from "../../../../../../core/global/chart/chart.ts";
import type { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import type { PreviewRuntime } from "./PreviewProvider.tsx";
import type { EditorSessionRuntime } from "./SessionProvider.tsx";
import type { TimelineRuntime } from "./TimelineProvider.tsx";

/** Transport, playback clocks, metrics, and draft autosave for one editor mount. */
export interface PlaybackRuntime {
  chartSeconds(): number;
  currentBeat(): number;
  readonly playback: EditorPlayback;
  readonly playbackMetrics: PlaybackMetrics;
  readonly autoSave: AutoSaveClock;
  seekBeat(beat: number, pause?: boolean): void;
  /**
   * Move the transport by a beat delta from wheel input.
   *
   * A running transport seeks immediately and keeps playing; a paused transport
   * glides toward the accumulated target so the playhead does not jump.
   */
  seekByBeats(deltaBeats: number, minimumSeconds: number): void;
  togglePlayback(): Promise<void>;
  dispose(): void;
}

const PlaybackRuntimeContext = createContext<PlaybackRuntime | null>(null);

/** Time constant of the wheel chase; lower is snappier, higher is softer. */
const WHEEL_SEEK_TAU_SECONDS = 0.055;
/** Stop when the remaining distance is inaudible, then land exactly on target. */
const WHEEL_SEEK_EPSILON_SECONDS = 0.0005;
/** A transport seek from another surface cancels the chase. */
const WHEEL_SEEK_EXTERNAL_EPSILON_SECONDS = 0.02;

interface WheelSeekState {
  /** Last position written to the transport. */
  current: number;
  target: number;
  targetBeat: number;
  minimum: number;
  last: number;
  frame: number | null;
}

/** Publishes the playback runtime to descendants, or null before it exists. */
export function PlaybackProvider({
  runtime,
  children,
}: {
  runtime: PlaybackRuntime | null;
  children: ReactNode;
}) {
  return (
    <PlaybackRuntimeContext.Provider value={runtime}>{children}</PlaybackRuntimeContext.Provider>
  );
}

/** Reads the playback runtime, or null while it is not mounted. */
export function usePlaybackRuntime(): PlaybackRuntime | null {
  return useContext(PlaybackRuntimeContext);
}

/** Builds the transport, wheel-seek chase, metrics, and autosave clock. */
export function createPlaybackRuntime(options: {
  session: EditorSessionRuntime;
  preview: PreviewRuntime;
  timeline: TimelineRuntime["timeline"];
  documents: TauriDocumentStore | null;
  assets(): AssetMap;
  setLastDraftDocument(chart: Chart): void;
  notify(message: string, severity?: string): void;
  failureMessage(error: unknown): string;
  invalidate(): void;
  offsetSeconds(): number;
  tempo(): TempoMap;
}): PlaybackRuntime {
  const { audio, hitSounds, realtimePreview } = options.preview;
  const chartSeconds = () => audio.time - options.offsetSeconds();
  const currentBeat = () =>
    options.tempo().beat(chartSeconds(), options.session.current.line?.bpmfactor ?? 1);
  const playback = new EditorPlayback(audio, hitSounds, () => {
    options.timeline.viewport.setPlaybackActive(audio.playing || playback.pending);
    options.timeline.viewport.setOrigin(currentBeat(), "seek");
    realtimePreview.effectsSince = chartSeconds();
    options.invalidate();
  });
  const playbackMetrics = new PlaybackMetrics();
  let wheelSeek: WheelSeekState | null = null;

  /** Cancels the paused wheel chase and releases its animation frame. */
  function cancelWheelSeek(): void {
    if (!wheelSeek) {
      return;
    }
    if (wheelSeek.frame !== null) {
      cancelAnimationFrame(wheelSeek.frame);
    }
    wheelSeek = null;
  }

  /** Advances the paused wheel chase toward its target on one animation frame. */
  function stepWheelSeek(state: WheelSeekState): void {
    if (wheelSeek !== state) {
      return;
    }
    const now = performance.now();
    const elapsed = Math.min(0.05, Math.max(0, (now - state.last) / 1000));
    state.last = now;
    // A seek from the overview, a command, playback, or the transport itself owns
    // the position now. The chase must not pull the playhead back toward its old
    // target.
    if (
      audio.playing ||
      playback.pending ||
      Math.abs(audio.time - state.current) > WHEEL_SEEK_EXTERNAL_EPSILON_SECONDS
    ) {
      wheelSeek = null;
      return;
    }
    const blend = 1 - Math.exp(-elapsed / WHEEL_SEEK_TAU_SECONDS);
    state.current += (state.target - state.current) * blend;
    const done = Math.abs(state.target - state.current) <= WHEEL_SEEK_EPSILON_SECONDS;
    if (done) {
      state.current = state.target;
    }
    const next = Math.max(state.minimum, state.current);
    playback.seek(next);
    state.current = next;
    if (done) {
      wheelSeek = null;
      return;
    }
    state.frame = requestAnimationFrame(() => stepWheelSeek(state));
  }

  /**
   * Accumulate a wheel notch onto the target beat rather than the transport's
   * lagging position, so holding the wheel keeps moving while frames catch up.
   *
   * Wheel seeking pauses the transport first: the wheel is a navigation gesture,
   * and scrolling while audio runs would fight the transport for the playhead.
   * The paused path then glides toward the target so the playhead does not jump.
   */
  function seekByBeats(deltaBeats: number, minimumSeconds: number): void {
    if (!Number.isFinite(deltaBeats) || deltaBeats === 0) {
      return;
    }
    const current = options.session.current;
    const factor = current.line?.bpmfactor ?? 1;
    const offset = (current.chart.META.offset ?? 0) / 1000;
    const tempo = options.tempo();
    // Negative chart time is the pre-roll before beat zero. The viewport's
    // minimum already keeps beat zero at the top edge, so the transport must not
    // clamp it back to zero.
    const minimum = Number.isFinite(minimumSeconds) ? minimumSeconds : 0;
    // A chart may extend past its audio, so the wheel can scrub to the last
    // note or event even when the media ends earlier. Audio time is chart time
    // plus the document offset.
    const mediaEnd = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const chartEnd = options.preview.timelineActivity.duration;
    const chartAudioEnd = Number.isFinite(chartEnd) && chartEnd > 0 ? chartEnd + offset : 0;
    const maximum = Math.max(mediaEnd, chartAudioEnd) || Infinity;
    const maximumBeat = Number.isFinite(maximum) ? tempo.beat(maximum - offset, factor) : Infinity;

    if (audio.playing || playback.pending) {
      // The paused glide owns the playhead from here; the running transport's
      // own wheel target would be stale.
      playback.pause();
      cancelWheelSeek();
    }

    // An API or overview seek can land between two wheel notches. The old chase
    // is stale then: start a new one from where the transport actually is.
    if (
      wheelSeek &&
      Math.abs(audio.time - wheelSeek.current) > WHEEL_SEEK_EXTERNAL_EPSILON_SECONDS
    ) {
      cancelWheelSeek();
    }
    if (!wheelSeek) {
      wheelSeek = {
        current: audio.time,
        target: audio.time,
        targetBeat: tempo.beat(audio.time - offset, factor),
        minimum,
        last: performance.now(),
        frame: null,
      };
    }
    const state = wheelSeek;
    state.targetBeat = Math.min(
      maximumBeat,
      Math.max(tempo.beat(minimum - offset, factor), state.targetBeat + deltaBeats),
    );
    state.target = Math.max(
      minimum,
      Math.min(maximum, tempo.seconds(state.targetBeat, factor) + offset),
    );
    state.minimum = minimum;
    if (state.frame === null) {
      state.frame = requestAnimationFrame(() => stepWheelSeek(state));
    }
  }

  options.timeline.gestures.onDragScroll = (seconds) => {
    cancelWheelSeek();
    playback.seek(audio.time + seconds);
  };
  const autoSave = new AutoSaveClock(
    async () => {
      const current = options.session.current;
      const document = current.chart;
      const snapshot = { ...document };
      delete snapshot.chartTime;
      if (!options.documents) {
        throw new Error(t("editor.app.notice.desktopOnlyBackup"));
      }
      const progress = showProgressToast(t("editor.app.notice.backupSaving"), "info");
      progress.setProgress(0.05);
      try {
        await options.documents.recover(
          snapshot,
          new Map(options.assets()),
          { lineIndex: current.lineIndex },
          (value) => progress.setProgress(0.05 + value * 0.9),
        );
        if (current === options.session.current) {
          options.setLastDraftDocument(document);
          progress.finish(t("editor.app.notice.backupSaved"), "success");
        } else {
          progress.dismiss();
        }
      } catch (error) {
        progress.fail(
          t("editor.app.notice.backupFailed", {
            message: options.failureMessage(error),
          }),
        );
      }
    },
    (error: unknown) =>
      options.notify(
        t("editor.app.notice.backupFailed", { message: options.failureMessage(error) }),
        "error",
      ),
    idleScheduler,
  );

  /** Seeks to a beat in the current line's time factor and pauses by default. */
  function seekBeat(value: number, pause = true): void {
    cancelWheelSeek();
    playback.seek(
      options.tempo().seconds(value, options.session.current.line?.bpmfactor ?? 1) +
        (options.session.current.chart.META.offset ?? 0) / 1000,
      pause,
    );
    options.invalidate();
  }

  /** Starts or stops the transport for the current chart. */
  async function togglePlayback(): Promise<void> {
    cancelWheelSeek();
    const starting = !audio.playing && !playback.pending;
    options.timeline.viewport.setPlaybackActive(starting);
    if (!audio.playing && !playback.pending) {
      realtimePreview.effectsSince = chartSeconds() - 0.001;
    }
    await playback.toggle(options.session.current.chart);
    options.timeline.viewport.setPlaybackActive(audio.playing || playback.pending);
    options.invalidate();
  }

  return {
    chartSeconds,
    currentBeat,
    playback,
    playbackMetrics,
    autoSave,
    seekBeat,
    seekByBeats,
    togglePlayback,
    /** Stops the chase, cancels autosave, and pauses the transport. */
    dispose() {
      cancelWheelSeek();
      autoSave.cancel();
      void playback.pause();
      options.timeline.viewport.setPlaybackActive(false);
    },
  };
}
