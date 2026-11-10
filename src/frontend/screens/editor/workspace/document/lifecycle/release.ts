/**
 * Releases resource owners in a fixed order before a document is replaced.
 * Ownership stays with the features; this module only sequences their clear
 * calls so the next session starts from a quiet runtime.
 */
import type { SceneRuntime } from "../../../../../../core/global/chart/runtime/scene.ts";
import type { EditorPlayback } from "../../../../../../core/edit/playback/transport.ts";
import type { AudioTransport } from "../../../../../../core/media/audio.ts";
import type { HitSounds } from "../../../../../../core/media/hitsounds.ts";
import type { ProjectImages } from "../../../../../../core/media/images.ts";

/** Resource owners cleared before a document is replaced. */
export interface DocumentReleaseOptions {
  lineSwitcher: { reset(): void };
  lineInfoScene: Pick<SceneRuntime, "clear">;
  assetLibrary: { disposeUrls(): void };
  trajectory: { clearDocument(): void };
  playback: Pick<EditorPlayback, "pause">;
  audio: Pick<AudioTransport, "clear">;
  preview: { clearDocument(): void };
  clearAnalysis(): void;
  clearSpectrum(): void;
  hitSounds: Pick<HitSounds, "stop" | "onlyCurrentLine">;
  images: Pick<ProjectImages, "clear">;
  clearLibraryProject(): void;
  /** Release a stream worker or source owned by the outgoing document. */
  disposeChartDocument(): void;
}

/** Release resource owners before the current session is replaced. */
export function createDocumentRelease(options: DocumentReleaseOptions): () => void {
  return () => {
    options.lineSwitcher.reset();
    options.lineInfoScene.clear();
    options.assetLibrary.disposeUrls();
    options.trajectory.clearDocument();
    options.playback.pause();
    options.audio.clear();
    options.preview.clearDocument();
    options.clearAnalysis();
    options.clearSpectrum();
    options.hitSounds.stop();
    options.hitSounds.onlyCurrentLine = false;
    options.images.clear();
    options.disposeChartDocument();
    options.clearLibraryProject();
  };
}
