/**
 * Keeps the curve surface in sync with the chart transport.
 *
 * The curve draft is not a separate renderer: the chart underlay is always
 * visible, and the A-B marker is the current transport position mapped into the
 * generation range. The hook publishes progress and loop seeks to the shared
 * transport; it never paints a separate preview. While the transport plays it
 * hands progress straight to the marker canvas instead of updating the shared
 * store, so playback does not re-render the overlay or its inspector.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { beatValue } from "../../../../core/global/chart/timing/beat.ts";
import { editorLine, editorLoopRange } from "../../../../core/edit/state/publishedValues.ts";
import type { EditorRuntime } from "../workspace/runtime/composition/EditorRuntime.tsx";
import { applyCurvePreviewLine, curvePreviewLineTargets } from "./previewIsolation.ts";
import { curvePreviewState, updateCurvePreview } from "./store.ts";

/** Clamp the transport beat to a 0-1 progress inside the A-B range. */
function progressInside(start: number, end: number, beat: number): number {
  const span = end - start;
  if (!(span > 0)) {
    return 0;
  }
  return Math.max(0, Math.min(1, (beat - start) / span));
}

/**
 * Publish transport progress to the curve surface and seek the shared transport
 * back to A when loop playback reaches B.
 *
 * `onProgress` paints the marker at most once per animation frame; paused
 * transport still synchronizes `previewProgress` so React-driven redraws see
 * the settled position.
 */
export function useCurvePreviewPlayback(options: {
  active: boolean;
  previewLineOnly: boolean;
  runtime: EditorRuntime | null;
  onProgress: (progress: number) => void;
}): void {
  const { active, previewLineOnly, runtime } = options;
  const publishedLine = useSyncExternalStore(editorLine.subscribe, editorLine.get, editorLine.get);
  const onProgressRef = useRef(options.onProgress);
  onProgressRef.current = options.onProgress;

  // The edited line is highlighted for the whole curve session, not only while
  // the transport runs; the checkbox decides whether the rest of the chart is
  // hidden as well. `editorLine` is the published selection cell, so switching
  // lines while the pane is open re-applies the filter instead of leaving it on
  // the previous line.
  useEffect(() => {
    const preview = runtime?.preview;
    if (!preview) {
      return;
    }
    const parsed = Number(publishedLine);
    const line =
      Number.isInteger(parsed) && parsed >= 0 ? parsed : (runtime?.session.lineIndex ?? 0);
    applyCurvePreviewLine(
      preview,
      curvePreviewLineTargets({ active, previewLineOnly, lineIndex: line }),
    );
    return () => applyCurvePreviewLine(preview, { soloLine: null, focusLine: null });
  }, [active, previewLineOnly, runtime, publishedLine]);

  // Publish the active A-B range for the shared transport's visual marker. The
  // range is in audio seconds because the progress card reads the audio clock;
  // chart beats are converted through the live tempo map and chart offset.
  // Playback still loops over this range, but the transport remains full-track
  // so its spectrum never needs to be re-analysed or stretched.
  useEffect(() => {
    if (!active || !runtime) {
      editorLoopRange.set(null);
      return;
    }
    const publish = () => {
      const state = curvePreviewState.get();
      const start = beatValue(state.startBeat);
      const end = beatValue(state.endBeat);
      if (!state.loopEnabled || !(end > start)) {
        editorLoopRange.set(null);
        return;
      }
      const offset = Number(runtime.session.chart.META.offset ?? 0) / 1000;
      const tempo = runtime.timeline.viewport.tempo;
      editorLoopRange.set({
        start: tempo.seconds(start) + offset,
        end: tempo.seconds(end) + offset,
      });
    };
    publish();
    const stop = curvePreviewState.subscribe(publish);
    const session = runtime.session;
    session.addEventListener("change", publish);
    return () => {
      stop();
      session.removeEventListener("change", publish);
      editorLoopRange.set(null);
    };
  }, [active, publishedLine, runtime]);

  useEffect(() => {
    if (!active || !runtime) {
      return;
    }
    let frame = 0;
    let lastDrawn: number | null = null;
    const tick = () => {
      const state = curvePreviewState.get();
      const start = beatValue(state.startBeat);
      const end = beatValue(state.endBeat);
      const current = runtime.providers.playback.currentBeat();
      const progress = progressInside(start, end, current);
      if (runtime.audio.playing) {
        if (lastDrawn === null || Math.abs(progress - lastDrawn) > 0.0005) {
          lastDrawn = progress;
          onProgressRef.current(progress);
        }
      } else {
        lastDrawn = null;
        if (Math.abs(state.previewProgress - progress) > 0.001) {
          updateCurvePreview({ previewProgress: progress }, { persist: false });
        }
      }
      // The shared transport is the only clock. Loop by seeking the same
      // transport back to A; the curve surface never starts or stops playback.
      if (state.loopEnabled && runtime.audio.playing && end > start && current >= end) {
        runtime.providers.playback.seekBeat(start, false);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, runtime]);
}
