/**
 * Composes the stage in paint order: preview underlay, authoring surface, and the
 * feature overlays. Each overlay owner keeps its subscriptions; this component
 * only places the hosts.
 */
import { useMemo, useSyncExternalStore } from "react";
import { curvePreviewMode } from "../../../curveEvents/mode.ts";
import { CurveEventsOverlay } from "../../../curveEvents/CurveEventsOverlay.tsx";
import { Editor } from "../../editor/surface/Editor.tsx";
import { useTimelineDomSurface } from "../../timeline/surface/TimelineDomSurface.tsx";
import { PreviewCanvases } from "../../preview/surface/PreviewCanvases.tsx";
import { AudioAnalysisCanvas } from "../../timeline/audioAnalysis/AudioAnalysisCanvas.tsx";
import { ExtensionOverlays } from "../../../../../platform/ExtensionOverlays.tsx";
import { BatchControlsOverlay } from "../batchControls/BatchControlsOverlay.tsx";
import { LineInfoOverlay } from "../lineInfo/LineInfoOverlay.tsx";
import { TrajectoryOverlay } from "../trajectoryOverlay/TrajectoryOverlay.tsx";
import { OverlapMenuHost } from "../../../../../overlays/overlap/OverlapMenuHost.tsx";
import { FreeCameraOverlay } from "../freeCamera/FreeCameraOverlay.tsx";
import { freeCameraState } from "../freeCamera/freeCamera.ts";
import { SamplingOverlay } from "../sampling/SamplingOverlay.tsx";
import { samplingSession } from "../../../sampling/samplingSession.ts";
import { mergeRefs } from "../../../../../platform/mergeRefs.ts";
import { onboardingAnchorRef } from "../../../../../onboarding/anchors.ts";

/** Compose the stage in paint order; each feature owns its subscriptions and DOM bindings. */
export function CanvasStage() {
  const { stage, selectionOverlay, selectionOverlayBatch } = useTimelineDomSurface().attach;
  const curvePreviewActive = useSyncExternalStore(
    curvePreviewMode.subscribe,
    curvePreviewMode.get,
    curvePreviewMode.get,
  );
  const freeCameraActive = useSyncExternalStore(
    freeCameraState.subscribe,
    () => freeCameraState.get().active,
    () => false,
  );
  const samplingActive = useSyncExternalStore(
    samplingSession.subscribe,
    () => Boolean(samplingSession.get().target),
    () => false,
  );
  // Keep the callback stable: a new ref on every mode-class render detaches the
  // stage cell during the same commit a child layout effect reads it.
  const stageRef = useMemo(() => mergeRefs(stage, onboardingAnchorRef("stage")), [stage]);
  return (
    <div
      id="stage"
      className={`stage${curvePreviewActive ? " curve-preview-active" : ""}${freeCameraActive ? " free-camera-active" : ""}${samplingActive ? " sampling-active" : ""}`}
      ref={stageRef}
    >
      <BatchControlsOverlay />
      <PreviewCanvases />
      <AudioAnalysisCanvas />
      <canvas ref={selectionOverlayBatch} className="selection-overlay-batch" aria-hidden="true" />
      <canvas ref={selectionOverlay} className="selection-overlay" aria-hidden="true" />
      <Editor />
      <ExtensionOverlays />
      <LineInfoOverlay />
      <TrajectoryOverlay />
      <CurveEventsOverlay />
      <FreeCameraOverlay allowDragging={!samplingActive} />
      <SamplingOverlay />
      <OverlapMenuHost />
    </div>
  );
}
