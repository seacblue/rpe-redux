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

/** Mutable counters and dirty flag carried across editor frames. */
export interface EditorFrameState {
  lastInfoTick: number;
  frameSampleStart: number;
  frameSampleCount: number;
  measuredFps: number;
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
    measuredFps: 0,
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
    state.animationCallbacks++;
    const overlayDue = overlayCadence.allow(timestamp, 60);
    clock.advance(timestamp, state, overlayDue);
    readouts.updateClock(timestamp, state);
    if (visibility.hasDocument() && !visibility.atHome() && !visibility.documentHidden()) {
      autosave.tick(timestamp);
    }
    const current = clock.sample();
    if (
      !visibility.atHome() &&
      !visibility.documentHidden() &&
      (clock.playing() || state.dirty || drawing.active() || drawing.interacting())
    ) {
      state.frameSampleCount++;
      state.paintedFrames++;
      const start = performance.now();
      const seconds = clock.seconds(timestamp);
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
        options.contentRefreshRate(),
      );
      readouts.publishProgress(timestamp, seconds, audioSeconds, current.tempo, beat);
      if (refreshHud) {
        readouts.publish(timestamp, state, current.session);
      }
      readouts.performance(timestamp, start, state);
      state.dirty = false;
      if (clock.playing()) {
        options.metrics.record(timestamp, performance.now() - start, seconds);
      }
    }
    options.schedule(
      !visibility.atHome() && (clock.playing() || drawing.interacting()),
      visibility.documentHidden(),
      clock.playing(),
    );
  };
}
