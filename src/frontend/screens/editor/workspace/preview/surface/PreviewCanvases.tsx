/**
 * Mounts the preview underlay's canvases in one isolated stacking context and
 * attaches them to the preview surface handle. React owns the nodes; the preview
 * runtime owns their drawing.
 */
import { useSyncExternalStore } from "react";
import { t } from "../../../../../../i18n/index.ts";
import { editorRealtimePreviewEnabled } from "../../../../../../core/edit/state/publishedValues.ts";
import { usePreviewRuntime } from "../../runtime/providers/PreviewProvider.tsx";
import { usePreviewSurface } from "./PreviewDomSurface.tsx";
import { curvePreviewMode } from "../../../curveEvents/mode.ts";
import { freeCameraState } from "../../stage/freeCamera/freeCamera.ts";
import {
  getEditorRegionSnapshot,
  subscribeToEditorRegions,
} from "../../runtime/commands/viewControls.ts";

/**
 * The preview underlay's canvases, kept in one stacking context.
 *
 * The wrapper matters: the layers inside carry their own z-indexes (the note
 * batch below the shader, the overlay above both), and without a local stacking
 * context those numbers would compete with the authoring canvases in the stage.
 * The preview must always sit *below* every timeline layer, so it is isolated
 * here and ordered by the DOM: the editor region is rendered after it.
 */
export function PreviewCanvases() {
  const { attach } = usePreviewSurface();
  const { canvas, noteBatch, shader, overlay } = attach;
  const runtime = usePreviewRuntime();
  const enabled = useSyncExternalStore(
    editorRealtimePreviewEnabled.subscribe,
    editorRealtimePreviewEnabled.get,
    editorRealtimePreviewEnabled.get,
  );
  const curveActive = useSyncExternalStore(
    curvePreviewMode.subscribe,
    curvePreviewMode.get,
    curvePreviewMode.get,
  );
  const cameraActive = useSyncExternalStore(
    freeCameraState.subscribe,
    () => freeCameraState.get().active,
    () => false,
  );
  const regions = useSyncExternalStore(
    subscribeToEditorRegions,
    getEditorRegionSnapshot,
    getEditorRegionSnapshot,
  );
  // The preview is the workspace's fallback surface when neither authoring
  // region is shown, even if its own switch is off.
  const fallback = !regions.showNotes && !regions.showEvents;
  return (
    <div
      className="preview-underlay"
      hidden={!runtime || !(enabled || fallback || cameraActive || curveActive)}
    >
      <canvas
        id="realtime-preview"
        className="preview-main-canvas"
        ref={canvas}
        role="img"
        aria-label={t("chrome.preview.canvas")}
      />
      <canvas ref={noteBatch} className="preview-note-batch" aria-hidden="true" />
      {/* The runtime toggles visibility after a shader pass succeeds. Keeping
          the node mounted lets the editor preview use the same compositing
          surface as the dedicated preview and recording paths. */}
      <canvas ref={shader} className="preview-shader-layer" aria-hidden="true" />
      <canvas ref={overlay} className="preview-overlay-layer" aria-hidden="true" />
      <div className="free-camera-frame-clip" aria-hidden="true">
        <div className="free-camera-frame" />
      </div>
    </div>
  );
}
