/**
 * Replaces the document's track and applies the media side effects in their
 * established order: pause, asset update, duration, markers, transport restore,
 * then waveform and spectrum analysis. Audio and analysis owners are injected;
 * this module owns only the order and keeps analysis off the playhead.
 */
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";

type MusicSession = Pick<EditorSession, "chart" | "commitChart">;

/** Audio, analysis, and session operations the music loader drives. */
export interface MusicLoaderDependencies {
  loadAudio(bytes: string | ArrayBuffer | Uint8Array, name: string): Promise<boolean>;
  pause(): void;
  seek(seconds: number): void;
  chartSeconds(): number;
  offsetSeconds(): number;
  getSession(): MusicSession;
  setAnalysisSource(source: Uint8Array | string): void;
  analysisEnabled(): boolean;
  ensureAnalysis(): Promise<unknown>;
  reportError(error: unknown): void;
  setAsset(name: string, bytes: Uint8Array): void;
  setProgressDuration(duration: number): void;
  duration(): number;
  queueSpectrum(source: Uint8Array | string): void;
  renderTimelineMarkers(): void;
  commitLabel(): string;
  /** Announce a fully installed track after metadata and the transport restore. */
  onLoaded?(name: string): void;
}

/** Loads a track, restores the playhead, then starts background analysis. */
export function createMusicLoader(deps: MusicLoaderDependencies) {
  return async (bytes: Uint8Array | string, name: string, updateMetadata = true) => {
    const chartPosition = deps.chartSeconds();
    deps.pause();
    const loadingSession = deps.getSession();
    const loaded = await deps.loadAudio(bytes, name);
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
    // Restore the transport before the waveform owns any work. The analysis is
    // deliberately not awaited: playback is ready as soon as the decoded buffer
    // is installed, and a later waveform completion must only repaint.
    deps.seek(chartPosition + deps.offsetSeconds());
    deps.onLoaded?.(name);
    deps.setAnalysisSource(bytes);
    if (deps.analysisEnabled()) {
      deps.ensureAnalysis().catch(deps.reportError);
    }
    deps.queueSpectrum(bytes);
  };
}
