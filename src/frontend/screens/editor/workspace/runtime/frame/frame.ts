/**
 * Composes one editor frame from its clock, drawing, readouts, and autosave
 * parts, and exposes the state the runner inspects. The runner owns scheduling;
 * this module owns the frame's work order.
 */
import { createFrameClock, type FrameClockOptions } from "./frameClock.ts";
import { createFrameDrawing, type FrameDrawingOptions } from "./frameDrawing.ts";
import { createFrameReadouts, type FrameReadoutOptions } from "./frameReadouts.ts";
import {
  createFrameAutosave,
  type FrameAutosaveOptions,
} from "../../document/save/frameAutosave.ts";
import type { PlaybackMetrics } from "../../../../../../core/edit/perf/playbackMetrics.ts";
import { FrameCadence } from "./frameCadence.ts";

interface FrameTaskTimingProbe {
  (sample: {
    clockMs: number;
    autosaveMs: number;
    drawMs: number;
    progressMs: number;
    readoutsMs: number;
    performanceMs: number;
    scheduleMs: number;
    totalMs: number;
  }): void;
}

/** Reports the full RAF task so non-canvas work cannot hide behind paint timings. */
function reportFrameTaskTiming(sample: Parameters<FrameTaskTimingProbe>[0]): void {
  const probe = (
    globalThis as typeof globalThis & { __reduxFrameTaskTimingProbe?: FrameTaskTimingProbe }
  ).__reduxFrameTaskTimingProbe;
  probe?.(sample);
}

/** Mutable counters and dirty flag carried across editor frames. */
export interface EditorFrameState {
  lastInfoTick: number;
  frameSampleStart: number;
  /** Frames that actually painted during the current 500 ms window. */
  frameSampleCount: number;
  /** rAF callbacks counted at the previous window boundary. */
  frameSampleCallbacks: number;
  /** Raw rAF callback rate for the last window. */
  measuredFps: number;
  /** Painted-frame rate for the last window. */
  measuredPaintFps: number;
  animationCallbacks: number;
  paintedFrames: number;
  lastTick: number;
  lastHudPaint: number;
  dirty: boolean;
}

/** Creates the frame state with its first paint already requested. */
export function createEditorFrameState(): EditorFrameState {
  return {
    lastInfoTick: 0,
    frameSampleStart: 0,
    frameSampleCount: 0,
    frameSampleCallbacks: 0,
    measuredFps: 0,
    measuredPaintFps: 0,
    animationCallbacks: 0,
    paintedFrames: 0,
    lastTick: 0,
    lastHudPaint: -Infinity,
    dirty: true,
  };
}

/** Gates that decide whether the editor is on screen and should repaint. */
export interface FrameVisibility {
  atHome(): boolean;
  hasDocument(): boolean;
  documentHidden(): boolean;
}
/** Work supplied by the composition root for one editor frame. */
export interface FrameRunnerOptions {
  state: EditorFrameState;
  visibility: FrameVisibility;
  clock: FrameClockOptions;
  drawing: FrameDrawingOptions;
  readouts: FrameReadoutOptions;
  autosave: FrameAutosaveOptions;
  metrics: Pick<PlaybackMetrics, "record">;
  contentRefreshRate(): number;
  schedule(continuous: boolean, hidden: boolean, playing: boolean): void;
}

/** Orchestrate clocks → readouts → recovery → audio → gated drawing → scheduling. */
export function createEditorFrameRunner(options: FrameRunnerOptions): (timestamp: number) => void {
  const { state, visibility } = options;
  const clock = createFrameClock(options.clock, visibility);
  const drawing = createFrameDrawing(options.drawing);
  const readouts = createFrameReadouts(options.readouts, visibility);
  const autosave = createFrameAutosave(options.autosave);
  const overlayCadence = new FrameCadence();
  return (timestamp) => {
    const taskStarted = performance.now();
    state.animationCallbacks++;
    const overlayDue = overlayCadence.allow(timestamp, 60);
    let phaseStarted = performance.now();
    clock.advance(timestamp, state, overlayDue);
    readouts.updateClock(timestamp, state);
    const clockMs = performance.now() - phaseStarted;
    phaseStarted = performance.now();
    if (visibility.hasDocument() && !visibility.atHome() && !visibility.documentHidden()) {
      autosave.tick(timestamp);
    }
    const autosaveMs = performance.now() - phaseStarted;
    let painted = false;
    let drawMs = 0;
    let progressMs = 0;
    let readoutsMs = 0;
    let performanceMs = 0;
    const current = clock.sample();
    if (
      !visibility.atHome() &&
      !visibility.documentHidden() &&
      (clock.playing() || state.dirty || drawing.active() || drawing.interacting())
    ) {
      painted = true;
      state.frameSampleCount++;
      state.paintedFrames++;
      const start = performance.now();
      const seconds = clock.seconds(timestamp);
      const contentRefreshRate = options.contentRefreshRate();
      const audioSeconds = options.readouts.audio.time;
      // Expensive inspector and HUD work runs at its own lower cadence; the
      // transport follows the same sampled time on every frame.
      const refreshHud = state.dirty || timestamp - state.lastHudPaint >= 1000 / 12;
      const beat = drawing.draw(
        timestamp,
        seconds,
        current.session,
        current.tempo,
        refreshHud,
        state.dirty,
        contentRefreshRate,
      );
      drawMs = performance.now() - start;
      phaseStarted = performance.now();
      readouts.publishProgress(timestamp, seconds, audioSeconds, current.tempo, beat);
      progressMs = performance.now() - phaseStarted;
      phaseStarted = performance.now();
      if (refreshHud) {
        readouts.publish(timestamp, state, current.session);
      }
      readoutsMs = performance.now() - phaseStarted;
      phaseStarted = performance.now();
      readouts.performance(timestamp, start, state, contentRefreshRate);
      performanceMs = performance.now() - phaseStarted;
      state.dirty = false;
      if (clock.playing()) {
        options.metrics.record(timestamp, performance.now() - start, seconds);
      }
    }
    const scheduleStarted = performance.now();
    options.schedule(
      !visibility.atHome() && (clock.playing() || drawing.interacting()),
      visibility.documentHidden(),
      clock.playing(),
    );
    if (painted) {
      reportFrameTaskTiming({
        clockMs,
        autosaveMs,
        drawMs,
        progressMs,
        readoutsMs,
        performanceMs,
        scheduleMs: performance.now() - scheduleStarted,
        totalMs: performance.now() - taskStarted,
      });
    }
  };
}
