/**
 * Binds the editor's services to the settings values.
 *
 * Audio, hit sounds, preview, timeline, and session toggles are applied here when a
 * setting changes, once, for the whole runtime.
 */
import type { AudioPitchStrategy, AudioTransport } from "../../../core/media/audio.ts";
import type { HitSounds, HitSoundKind } from "../../../core/media/hitsounds.ts";
import type { Preview } from "../editor/workspace/preview/scene/preview.ts";
import type { Timeline } from "../editor/workspace/timeline/surface/timeline.ts";
import type { AudioAnalysis } from "../editor/workspace/timeline/audioAnalysis/audioAnalysis.ts";
import type { EditorSession } from "../../../core/edit/session/session.ts";
import { bindEditorSettings, readEditorDisplaySettings } from "./editorDisplaySettings.ts";
import {
  editorPreviewRatio,
  editorDivision,
  editorGridCount,
  editorScale,
  editorSnapX,
  editorRealtimePreviewEnabled,
} from "../../../core/edit/state/publishedValues.ts";
import "../../../core/settings/features/index.ts";
import { previewAspectRatio } from "../editor/workspace/preview/scene/viewport.ts";

/** Host services and callbacks the editor bindings apply settings to. */
export interface EditorSettingsBindings {
  getSession(): EditorSession;
  audio: Pick<AudioTransport, "volume" | "setVolume" | "setPitchStrategy">;
  hitSounds: Pick<HitSounds, "volume" | "setVolume" | "soundVolumes"> &
    Partial<Pick<HitSounds, "setSoundVolume">>;
  realtimePreview: Preview;
  timeline: Timeline;
  audioAnalysis: AudioAnalysis;
  /** Cancel a pending wheel zoom before settings replace its scale. */
  cancelTimelineZoom?: () => void;
  invalidate(): void;
  addCleanup(cleanup: () => void): void;
}

/** Apply the current settings once, then again after every settings change. */
export function createEditorSettingsBindings(options: EditorSettingsBindings) {
  /** Project the live services into the settings application call. */
  function applySettings(): void {
    options.cancelTimelineZoom?.();
    applyEditorSettings({
      timeline: options.timeline,
      realtimePreview: options.realtimePreview,
      audio: options.audio,
      hitSounds: options.hitSounds,
      audioAnalysis: options.audioAnalysis,
      session: options.getSession(),
      setPitchStrategy: (strategy) => options.audio.setPitchStrategy(strategy),
      invalidate: options.invalidate,
    });
  }

  options.addCleanup(bindEditorSettings(applySettings));
  return { applySettings };
}

/** Services and callbacks one settings application pass needs. */
export interface EditorDisplaySettingsDependencies {
  timeline: Timeline;
  realtimePreview: Preview;
  audio: Pick<AudioTransport, "volume" | "setVolume">;
  hitSounds: Pick<HitSounds, "soundVolumes" | "setVolume"> &
    Partial<Pick<HitSounds, "setSoundVolume">>;
  audioAnalysis: Pick<AudioAnalysis, "enabled" | "alpha" | "width">;
  session: EditorSession;
  setPitchStrategy(value: AudioPitchStrategy): void;
  invalidate(): void;
}

/** Push decoded settings into audio, preview, timeline, and session state. */
export function applyEditorSettings({
  timeline,
  realtimePreview,
  audio,
  hitSounds,
  audioAnalysis,
  session,
  setPitchStrategy,
  invalidate,
}: EditorDisplaySettingsDependencies): void {
  const config = readEditorDisplaySettings();
  audio.setVolume(config.volume);
  for (const [kind, value] of Object.entries(config.sounds) as [HitSoundKind, number][]) {
    hitSounds.setSoundVolume?.(kind, value);
  }
  Object.assign(audioAnalysis, config.analysis);
  const { defaultLineColor, defaultParticleColor, selectedLineColor, ...previewSettings } =
    config.preview;
  Object.assign(realtimePreview, previewSettings);
  realtimePreview.aspectRatio = previewAspectRatio(config.view.ratio);
  // Preview.draw caches an identical frame request for performance. Settings
  // such as line numbers and opacity change the frame without changing that
  // request, so drop the identity before invalidating the renderer.
  realtimePreview.invalidateFrame();
  realtimePreview.setDefaultColors({ defaultLineColor, defaultParticleColor, selectedLineColor });
  editorRealtimePreviewEnabled.set(config.preview.visible);
  if (session.multiLineMerge !== config.timeline.multiLineMergeNotes) {
    session.setMultiLineMerge(config.timeline.multiLineMergeNotes);
  }
  timeline.viewport.apply(config.timeline);
  timeline.appearance.apply(config.timeline);
  session.history.limit = config.historyLimit;
  session.cutDensity = config.cutDensity;
  editorDivision.set(String(timeline.viewport.division));
  editorGridCount.set(String(timeline.viewport.gridCount));
  editorScale.set(String(timeline.viewport.scale));
  editorSnapX.set(timeline.viewport.snapX);
  editorPreviewRatio.set(config.view.ratio);
  setPitchStrategy(config.pitchStrategy);
  invalidate();
}
