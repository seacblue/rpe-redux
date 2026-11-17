/**
 * Connects playback, audio, preview, and media owners to the core playback API,
 * keeping seek and selection mapping in one place. The returned disposer is the
 * binding lifetime; transport policy stays in core/edit.
 */
import { connectPlaybackApi } from "../../../../../../core/edit/playback/api.ts";
import type { EditorPlayback } from "../../../../../../core/edit/playback/transport.ts";
import type { PlaybackMetrics } from "../../../../../../core/edit/perf/playbackMetrics.ts";
import { editorRate } from "../../../../../../core/edit/state/publishedValues.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import type { AudioTransport } from "../../../../../../core/media/audio.ts";
import type { ProjectImages } from "../../../../../../core/media/images.ts";
import type { Preview } from "../scene/preview.ts";
import { selectionMapForSession } from "../interaction/previewSelection.ts";

/** Collaborators the playback binding reads and notifies. */
export interface EditorPlaybackBindings {
  getSession(): EditorSession;
  tempo(): TempoMap;
  audio: AudioTransport;
  playback: EditorPlayback;
  offsetSeconds(): number;
  hasDocument(): boolean;
  invalidate(): void;
  preview: Preview;
  images: ProjectImages;
  metrics: PlaybackMetrics;
}

/** Connect browser rendering and media owners to the core playback API. */
export function bindEditorPlayback(bindings: EditorPlaybackBindings): () => void {
  const {
    audio,
    getSession,
    images,
    invalidate,
    metrics,
    offsetSeconds,
    playback,
    preview,
    tempo,
  } = bindings;
  return connectPlaybackApi({
    chart: () => getSession().chart,
    tempo,
    state: () => {
      const audioSeconds = audio.time;
      const offset = offsetSeconds();
      return {
        loaded: bindings.hasDocument(),
        playing: audio.playing,
        pending: playback.pending,
        audioSeconds,
        chartSeconds: audioSeconds - offset,
        duration: audio.duration,
        rate: audio.rate,
        offsetSeconds: offset,
        lineIndex: getSession().lineIndex,
      };
    },
    play: async () => {
      await playback.play(getSession().chart);
      invalidate();
    },
    pause: () => {
      playback.pause();
      invalidate();
    },
    seek: (seconds, pause) => playback.seek(seconds, pause),
    setRate: (rate) => {
      // The rate is a value: writing it is what makes the editor apply it.
      editorRate.set(String(rate));
      invalidate();
    },
    render: (seconds) => {
      const visible = preview.visible;
      preview.visible = true;
      try {
        const session = getSession();
        preview.draw(
          session.chart,
          tempo(),
          seconds,
          session.lineIndex,
          selectionMapForSession(session),
          {
            selectedLines: session.targetLineIndices,
            documentRevision: session.contentRevision,
          },
        );
      } finally {
        preview.visible = visible;
      }
    },
    textures: () =>
      [...images.records.values()].map((record) => ({
        name: record.name,
        width: record.naturalWidth,
        height: record.naturalHeight,
        decoded: Boolean(record.image),
        pending: Boolean(record.pending),
        failed: record.failed,
        bytes: record.cost,
      })),
    frames: () =>
      [preview].flatMap((renderer) =>
        renderer.lastFrame
          ? [
              {
                canvas: renderer.canvas.id,
                ...renderer.lastFrame,
                notes: renderer.noteHitAreas.map((area) => ({ ...area })),
                lines: renderer.lineFrames.map((line) => ({ ...line })),
              },
            ]
          : [],
      ),
    metrics,
  });
}
