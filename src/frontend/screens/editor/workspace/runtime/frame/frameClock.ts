/**
 * Advances the editor's media and interaction clocks on every display callback,
 * even when the frame is not painted. Timing policy stays in the injected audio,
 * edit clock, and tempo owners.
 */
import type { AudioTransport } from "../../../../../../core/media/audio.ts";
import type { HitSounds } from "../../../../../../core/media/hitsounds.ts";

import type { EditorEditClock } from "../../../../../../core/edit/state/editClock.ts";

import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import type { Timeline } from "../../timeline/surface/timeline.ts";

import type { EditorFrameState, FrameVisibility } from "./frame.ts";
/** Clocks and callbacks advanced on every display callback. */
export interface FrameClockOptions {
  audio: Pick<AudioTransport, "update" | "playing" | "time" | "rate" | "duration" | "pause">;
  timeline: Pick<Timeline, "autoScroll">;
  lineSwitcher: { draw(timestamp: number): void };
  editClock: Pick<EditorEditClock, "advance">;
  hitSounds: Pick<HitSounds, "tick">;
  session(): EditorSession;
  tempo(): TempoMap;
  chartSeconds(): number;
  invalidate(): void;
}

/**
 * Interpolates the visual clock between coarse audio-clock samples.
 *
 * WebAudio remains the authority for audible time. This helper only fills the
 * gap between two monotonic samples so a display callback does not repaint the
 * same note position twice when the audio processing clock advances in larger
 * quanta. Large discontinuities reset the anchor and never smear a transport
 * jump across the canvas.
 */
export interface VisualPlaybackClock {
  /** Return chart time suitable for one display frame. */
  read(timestamp: number): number;
  /** Forget the interpolation anchor after an external transport change. */
  reset(): void;
}

/** Build a visual-only clock over the authoritative audio and chart clocks. */
export function createVisualPlaybackClock(options: {
  audio: Pick<AudioTransport, "playing" | "time" | "rate">;
  chartSeconds(): number;
}): VisualPlaybackClock {
  let anchorAudio = Number.NaN;
  let anchorTimestamp = Number.NaN;
  let previousAudio = Number.NaN;
  let previousTimestamp = Number.NaN;
  let anchorOffset = Number.NaN;
  let playing = false;

  const reset = (): void => {
    anchorAudio = Number.NaN;
    anchorTimestamp = Number.NaN;
    previousAudio = Number.NaN;
    previousTimestamp = Number.NaN;
    anchorOffset = Number.NaN;
    playing = false;
  };

  return {
    reset,
    read(timestamp: number): number {
      const audio = options.audio.time;
      const chart = options.chartSeconds();
      if (
        !options.audio.playing ||
        !Number.isFinite(timestamp) ||
        !Number.isFinite(audio) ||
        !Number.isFinite(chart)
      ) {
        reset();
        return chart;
      }

      const offset = audio - chart;
      const elapsedMs = Number.isFinite(previousTimestamp) ? timestamp - previousTimestamp : 0;
      const audioStep = Number.isFinite(previousAudio) ? audio - previousAudio : 0;
      const rate =
        Number.isFinite(options.audio.rate) && options.audio.rate > 0 ? options.audio.rate : 1;
      const discontinuity =
        !playing ||
        !Number.isFinite(anchorAudio) ||
        !Number.isFinite(anchorTimestamp) ||
        !Number.isFinite(anchorOffset) ||
        elapsedMs < 0 ||
        audioStep < -0.05 ||
        audioStep > Math.max(0.25, (Math.max(0, elapsedMs) / 1000) * rate * 8 + 0.05) ||
        Math.abs(offset - anchorOffset) > 0.05;

      if (discontinuity) {
        anchorAudio = audio;
        anchorTimestamp = timestamp;
        anchorOffset = offset;
        playing = true;
      } else if (audio > previousAudio + 0.000001) {
        // Prefer every newer authoritative sample, then interpolate only until
        // the next sample arrives.
        anchorAudio = audio;
        anchorTimestamp = timestamp;
        anchorOffset = offset;
      }

      previousAudio = audio;
      previousTimestamp = timestamp;
      const predictedAudio = anchorAudio + (Math.max(0, timestamp - anchorTimestamp) / 1000) * rate;
      return predictedAudio - offset;
    },
  };
}

/** Advance media/gesture clocks on every callback, even when painting is skipped. */
export function createFrameClock(options: FrameClockOptions, visibility: FrameVisibility) {
  const runtime = options;
  const visualClock = createVisualPlaybackClock({
    audio: runtime.audio,
    chartSeconds: runtime.chartSeconds,
  });
  return {
    /** Advances audio, scrolling, overlays, FPS sampling, and edit time. */
    advance(
      timestamp: number,
      state: Pick<
        EditorFrameState,
        "lastTick" | "frameSampleStart" | "measuredFps" | "frameSampleCount"
      >,
      overlayDue: boolean,
    ): void {
      const elapsed = state.lastTick ? (timestamp - state.lastTick) / 1000 : 0;
      state.lastTick = timestamp;
      runtime.audio.update();
      if (overlayDue && !visibility.atHome() && !visibility.documentHidden()) {
        runtime.lineSwitcher.draw(timestamp);
      }
      if (!visibility.atHome()) {
        runtime.timeline.autoScroll(elapsed);
      }
      if (timestamp - state.frameSampleStart >= 500) {
        state.measuredFps = (state.frameSampleCount * 1000) / (timestamp - state.frameSampleStart);
        state.frameSampleStart = timestamp;
        state.frameSampleCount = 0;
      }
      runtime.editClock.advance(
        timestamp,
        visibility.hasDocument() && !visibility.atHome() && !visibility.documentHidden(),
      );
    },
    /** Stops playback at the media end and returns the session and its tempo map. */
    sample() {
      if (runtime.audio.playing && runtime.audio.time >= runtime.audio.duration) {
        runtime.audio.pause();
        runtime.invalidate();
      }
      const session = runtime.session();
      const tempo = runtime.tempo();
      runtime.hitSounds.tick(session.chart, tempo, session.lineIndex);

      return { session, tempo };
    },
    playing: () => options.audio.playing,
    seconds: (timestamp: number) => visualClock.read(timestamp),
  };
}
