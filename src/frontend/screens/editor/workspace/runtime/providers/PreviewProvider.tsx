/** Owns preview media, skin resources, and the stage's chart-facing helpers. */
import { createContext, useContext, type ReactNode } from "react";
import { SceneRuntime } from "../../../../../../core/global/chart/runtime/scene.ts";
import { TimelineActivity } from "../../../../../../core/edit/timeline/activity.ts";
import { AudioTransport } from "../../../../../../core/media/audio.ts";
import { HitSounds } from "../../../../../../core/media/hitsounds.ts";
import { ProjectImages, type MediaIssue } from "../../../../../../core/media/images.ts";
import { NOTE_SKIN_EVENT } from "../../../../../platform/noteSkinBridge.ts";
import type { ToastContent } from "../../../../../../design/patterns/ToastHost.tsx";
import { Preview } from "../../preview/scene/preview.ts";
import { RpeSkin } from "../../../canvas/skin.ts";
import { createPreviewDisplay } from "../../preview/surface/previewDisplay.ts";
import { TimelineThumbnail } from "../../timeline/overview/timelineThumbnail.ts";
import { createLineInfoController } from "../../stage/lineInfo/lineInfoController.ts";
import { isDesktop } from "../../../../../../core/platform/environment.ts";
import { values } from "../../../../../../core/state/values.ts";
import { readCustomBackground } from "../../../../../platform/desktop/customBackground.ts";
import { t } from "../../../../../../i18n/index.ts";
import {
  collaborationPendingAssets,
  collaborationRoomDocument,
} from "../../../../../../core/collaboration/ui.ts";
import { readEditorDisplaySettings } from "../../../../settings/editorDisplaySettings.ts";
import {
  getEditorRegionSnapshot,
  previewVisibleForRegions,
  subscribeToEditorRegions,
} from "../commands/viewControls.ts";
import type { Timeline } from "../../timeline/surface/timeline.ts";
import type { ResourceScope } from "../../../../../../core/utils/resourceScope.ts";
import type { EditorSessionRuntime } from "./SessionProvider.tsx";
import type { EditorUiState } from "../composition/editorUiState.ts";
import type { PreviewSurface } from "../composition/editorSurfaces.ts";
import type { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import { curvePreviewMode } from "../../../curveEvents/mode.ts";
import { freeCameraState } from "../../stage/freeCamera/freeCamera.ts";
import { detailedNoiseRendering } from "../../../../../../core/edit/state/noiseRendering.ts";
import { bindBackgroundVolume } from "../../../../../platform/backgroundVolume.ts";
import { audioMixer } from "../../../../../../core/media/audioMixer.ts";

/** Preview media, skin resources, and stage helpers for one editor mount. */
export interface PreviewRuntime {
  readonly audio: AudioTransport;
  readonly hitSounds: HitSounds;
  readonly realtimePreview: Preview;
  readonly lineInfoScene: SceneRuntime;
  readonly lineInfo: ReturnType<typeof createLineInfoController>;
  readonly timelineActivity: TimelineActivity;
  readonly skin: RpeSkin;
  readonly images: ProjectImages;
  readonly timelineThumbnail: TimelineThumbnail;
  attachSkin(timeline: Timeline, scope: ResourceScope): void;
  dispose(): void;
}

const PreviewRuntimeContext = createContext<PreviewRuntime | null>(null);

/** Publishes the preview runtime to descendants, or null before it exists. */
export function PreviewProvider({
  runtime,
  children,
}: {
  runtime: PreviewRuntime | null;
  children: ReactNode;
}) {
  return (
    <PreviewRuntimeContext.Provider value={runtime}>{children}</PreviewRuntimeContext.Provider>
  );
}

/** Reads the preview runtime, or null while it is not mounted. */
export function usePreviewRuntime(): PreviewRuntime | null {
  return useContext(PreviewRuntimeContext);
}

/** Builds the preview media, skin, line info, and thumbnail for one editor mount. */
export function createPreviewRuntime(options: {
  preview: PreviewSurface;
  session: EditorSessionRuntime;
  ui: EditorUiState;
  invalidate: () => void;
  notify(content: string | ToastContent, severity?: string, duration?: number): void;
  /** Opens the asset drawer so a missing file can be added or relinked. */
  openAssets(): void;
  atHome(): boolean;
  offsetSeconds(): number;
  tempo(): TempoMap;
}): PreviewRuntime {
  const audio = new AudioTransport();
  audio.onError = () => {
    options.notify(t("system.audio.timeStretchUnavailable"), "warning");
  };
  const hitSounds = new HitSounds(audio);
  const removeAudioOwner = audioMixer.registerOwner({
    setMusicVolume: (value) => audio.setVolume(value),
  });
  const removeBackgroundVolume = bindBackgroundVolume((level) => audio.setBackgroundVolume(level));
  const backgroundClock = new Worker(new URL("./backgroundAudioClock.worker.ts", import.meta.url), {
    type: "module",
  });
  const isBackground = () => document.hidden || !document.hasFocus();
  const syncBackgroundClock = () => backgroundClock.postMessage(isBackground());
  backgroundClock.onmessage = () => {
    if (!isBackground() || options.atHome() || !audio.playing) {
      return;
    }
    audio.update();
    if (audio.time >= audio.duration) {
      audio.pause();
      options.invalidate();
      return;
    }
    const session = options.session.current;
    hitSounds.tick(session.chart, options.tempo(), session.lineIndex);
  };
  document.addEventListener("visibilitychange", syncBackgroundClock);
  window.addEventListener("focus", syncBackgroundClock);
  window.addEventListener("blur", syncBackgroundClock);
  syncBackgroundClock();
  const { preview } = options;
  const previewLayers = {
    noteBatch: preview.noteBatch,
    shader: preview.shader,
    overlay: preview.overlay,
    display: createPreviewDisplay(
      {
        primary: () => preview.canvas,
        noteBatch: () => preview.noteBatch,
        shader: () => preview.shader,
        overlay: () => preview.overlay,
      },
      "workspace-underlay",
    ),
  };
  const realtimePreview = new Preview(preview.canvas, previewLayers);
  realtimePreview.invalidate = options.invalidate;
  realtimePreview.noiseError = () =>
    options.notify(t("chrome.toolbar.noiseRenderingUnavailable"), "warning");
  realtimePreview.batchWarning = () =>
    options.notify(t("chrome.toolbar.previewBatchUnavailable"), "warning");
  realtimePreview.applyShaders = detailedNoiseRendering.get();
  let curvePreviewVisible = curvePreviewMode.get();
  /** Applies curve-preview visibility to the underlay and requests a repaint. */
  const refreshCurvePreview = (modeChanged = false) => {
    const visible = curvePreviewMode.get();
    if (visible === curvePreviewVisible && !modeChanged) {
      return;
    }
    curvePreviewVisible = visible;
    const regionVisible = previewVisibleForRegions(getEditorRegionSnapshot());
    realtimePreview.visible = visible || regionVisible;
    realtimePreview.forceOpaque = freeCameraState.get().active || visible;
    realtimePreview.invalidateFrame();
    window.dispatchEvent(new Event("resize"));
    options.invalidate();
  };
  const removeCurvePreviewBinding = curvePreviewMode.subscribe(() => refreshCurvePreview(true));
  // Underlay opacity follows which authoring regions share the stage. That is
  // not part of the chart/time frame request, so a region change must drop the
  // cached preview frame and request a repaint at the same moment.
  const removeRegionBinding = subscribeToEditorRegions(() => {
    realtimePreview.invalidateFrame();
    options.invalidate();
  });
  // The underlay is the only visible layer in free camera. Every pan or zoom
  // step repaints the chart content, background, and frame outline.
  const initialFreeCamera = freeCameraState.get();
  realtimePreview.camera = {
    active: initialFreeCamera.active,
    zoom: initialFreeCamera.zoom,
    panX: initialFreeCamera.panX,
    panY: initialFreeCamera.panY,
  };
  realtimePreview.forceOpaque = initialFreeCamera.active || curvePreviewVisible;
  const removeFreeCameraBinding = freeCameraState.subscribe(() => {
    const next = freeCameraState.get();
    const current = realtimePreview.camera;
    // Curve mode keeps the camera active for the whole surface; a stray
    // deactivation must not decouple the path from the chart underlay.
    if (curvePreviewMode.get() && !next.active) {
      return;
    }
    // Inactive pan values also drive the curve overlay; they must not repaint
    // the chart preview because the camera is not applied.
    if (!next.active && !current.active) {
      return;
    }
    if (
      next.active === current.active &&
      next.zoom === current.zoom &&
      next.panX === current.panX &&
      next.panY === current.panY
    ) {
      return;
    }
    realtimePreview.camera = {
      active: next.active,
      zoom: next.zoom,
      panX: next.panX,
      panY: next.panY,
    };
    realtimePreview.forceOpaque = next.active || curvePreviewVisible;
    realtimePreview.invalidateFrame();
    options.invalidate();
  });
  const removeNoiseBinding = detailedNoiseRendering.subscribe(() => {
    realtimePreview.applyShaders = detailedNoiseRendering.get();
    realtimePreview.invalidateFrame();
    options.invalidate();
  });
  const lineInfoScene = new SceneRuntime();
  const lineInfo = createLineInfoController({
    state: options.ui.lineInfo,
    scene: lineInfoScene,
    session: () => options.session.current,
    atHome: options.atHome,
    seconds: () => audio.time - options.offsetSeconds(),
    tempo: options.tempo,
  });
  const timelineActivity = new TimelineActivity();
  const skin = new RpeSkin(() => {
    // A skin swap changes pixels without changing the chart/time frame request,
    // so drop the cached frame before asking the editor to paint again.
    realtimePreview.invalidateFrame();
    options.invalidate();
  });
  const images = new ProjectImages(
    () => {
      realtimePreview.invalidateFrame();
      options.invalidate();
    },
    (issue: MediaIssue) => {
      if (issue.kind !== "missing") {
        options.notify(issue.message, "warning");
        return;
      }
      // A room asset that is still downloading is not a missing file. The
      // download path reloads the image when its bytes arrive. Room charts stay
      // quiet even before the manifest arrives; required audio and background
      // images are checked before the host creates the room.
      if (
        collaborationRoomDocument.get() ||
        collaborationPendingAssets.get().includes(issue.name)
      ) {
        return;
      }
      options.notify({
        message: issue.message,
        level: "warning",
        // Repeated loads of the same chart merge into this row instead of
        // stacking, and the row keeps its first lifetime.
        key: `media-missing:${issue.name}`,
        actions: [
          {
            label: t("system.image.missingAction"),
            dismissOnSelect: true,
            onSelect: () => options.openAssets(),
          },
        ],
      });
    },
  );
  const customBackground = values.getHandle<string | undefined>("custom-background");
  let customBackgroundRequest = 0;
  /** Loads the configured custom background, ignoring stale requests. */
  const applyCustomBackground = async (): Promise<void> => {
    const reference = customBackground.get()?.trim() ?? "";
    const request = ++customBackgroundRequest;
    if (!reference || !isDesktop()) {
      await images.loadCustomBackground(null, "");
      return;
    }
    try {
      const bytes = await readCustomBackground(reference);
      if (request === customBackgroundRequest) {
        await images.loadCustomBackground(bytes, reference);
      }
    } catch (error) {
      if (request === customBackgroundRequest) {
        console.error("Could not load the custom background", error);
        options.notify(t("settings.field.custom-background.error"), "warning");
        await images.loadCustomBackground(null, "");
      }
    }
  };
  const removeCustomBackgroundBinding = customBackground.subscribe(() => {
    void applyCustomBackground();
  });
  void applyCustomBackground();
  const timelineThumbnail = new TimelineThumbnail(
    {
      images,
      skin,
      colors: () => {
        const preview = readEditorDisplaySettings().preview;
        return {
          defaultLineColor: preview.defaultLineColor,
          defaultParticleColor: preview.defaultParticleColor,
          selectedLineColor: preview.selectedLineColor,
        };
      },
    },
    options.ui.timelineThumbnail,
  );

  return {
    audio,
    hitSounds,
    realtimePreview,
    lineInfoScene,
    lineInfo,
    timelineActivity,
    skin,
    images,
    timelineThumbnail,
    /** Binds the skin and images to a timeline and reloads them on skin events. */
    attachSkin(timeline, scope) {
      timeline.appearance.skin = skin;
      realtimePreview.skin = skin;
      realtimePreview.images = images;
      void skin.load().then(() => realtimePreview.prewarm());
      scope.listen(window, NOTE_SKIN_EVENT, () => {
        hitSounds.invalidateSkinAudio();
        void skin.applySelection().then(() => realtimePreview.prewarm());
      });
      document.fonts.load('35px "Source Han Sans CN"').then(options.invalidate);
    },
    /** Detaches every subscription and disposes preview-owned media. */
    dispose() {
      removeCurvePreviewBinding();
      removeRegionBinding();
      removeFreeCameraBinding();
      removeNoiseBinding();
      removeBackgroundVolume();
      document.removeEventListener("visibilitychange", syncBackgroundClock);
      window.removeEventListener("focus", syncBackgroundClock);
      window.removeEventListener("blur", syncBackgroundClock);
      backgroundClock.terminate();
      timelineThumbnail.dispose();
      removeAudioOwner();
      void audio.dispose();
      removeCustomBackgroundBinding();
      images.dispose();
      skin.dispose();
      hitSounds.dispose();
      realtimePreview.dispose();
    },
  };
}
