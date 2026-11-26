/**
 * Replaces the document's track and applies the media side effects in their
 * established order: pause, asset update, duration, markers, transport reset,
 * then waveform and spectrum analysis. Audio and analysis owners are injected;
 * this module owns only the order and keeps analysis off the playhead.
 */
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";

type MusicSession = Pick<EditorSession, "chart" | "commitChart">;

/** Audio, analysis, and session operations the music loader drives. */
export interface MusicLoaderDependencies {
  /**
   * Decode the track; `onDecoded` fires once the buffer is playable, before the
   * optional pitch stretcher finishes.
   */
  loadAudio(
    bytes: string | ArrayBuffer | Uint8Array,
    name: string,
    onDecoded?: (buffer: AudioBuffer) => void,
  ): Promise<boolean>;
  pause(): void;
  seek(seconds: number): void;
  offsetSeconds(): number;
  getSession(): MusicSession;
  setAnalysisSource(source: Uint8Array | string): void;
  analysisEnabled(): boolean;
  ensureAnalysis(): Promise<unknown>;
  reportError(error: unknown): void;
  setAsset(name: string, bytes: Uint8Array): void;
  setProgressDuration(duration: number): void;
  duration(): number;
  /** Queue the scrubber spectrum; `immediate` skips the idle delay. */
  queueSpectrum(source: Uint8Array | string, immediate?: boolean): void;
  renderTimelineMarkers(): void;
  commitLabel(): string;
  /** Announce a fully installed track after metadata and the transport reset. */
  onLoaded?(name: string): void;
}

/** Loads a track, resets the playhead to chart time zero, and starts analysis beside the open. */
export function createMusicLoader(deps: MusicLoaderDependencies) {
  return async (bytes: Uint8Array | string, name: string, updateMetadata = true) => {
    deps.pause();
    const loadingSession = deps.getSession();
    let analysisStarted = false;
    /**
     * Start both analyses as soon as the decoded buffer exists.
     *
     * `decodeForAnalysis` reuses the playable buffer, so this is not a second
     * decode. The worker work overlaps the chart and textures instead of
     * starting after the whole open has settled.
     */
    const startAnalysis = (): void => {
      if (analysisStarted) {
        return;
      }
      analysisStarted = true;
      deps.setAnalysisSource(bytes);
      if (deps.analysisEnabled()) {
        deps.ensureAnalysis().catch(deps.reportError);
      }
      deps.queueSpectrum(bytes, true);
    };
    const loaded = await deps.loadAudio(bytes, name, startAnalysis);
    if (!loaded || deps.getSession() !== loadingSession) {
      return;
    }
    if (typeof bytes !== "string") {
      deps.setAsset(name, bytes);
    }
    const duration = deps.duration();
    deps.setProgressDuration(duration);
    deps.renderTimelineMarkers();
    if (updateMetadata) {
      const session = deps.getSession();
      session.commitChart(
        deps.commitLabel(),
        {
          ...session.chart,
          META: { ...session.chart.META, song: name },
        },
        undefined,
        undefined,
        { normalized: true },
      );
    }
    // Reset the transport to chart time zero before the waveform owns any paint
    // work. Audio time includes the chart offset, so this is the same origin as
    // the editor's rewind command. Analysis may already be running from
    // `onDecoded`; this call is a no-op then.
    deps.seek(deps.offsetSeconds());
    deps.onLoaded?.(name);
    startAnalysis();
  };
}
