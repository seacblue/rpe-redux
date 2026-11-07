/**
 * Workspace sampler overlay.
 *
 * It paints the sampler guides over the free-camera preview, turns a pointer drag
 * into a two-anchor drag, and floats the easing editor over the completed path.
 * The sampling session owns the draft, the overlay owns pointer interaction,
 * and the core sampler owns snapping and the one chart commit.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useEditorRuntime } from "../../runtime/composition/EditorRuntime.tsx";
import { previewCameraView } from "../../preview/scene/previewCamera.ts";
import {
  freeCameraState,
  isFreeCameraDragButton,
  setFreeCameraView,
  wheelZoomDelta,
  zoomFreeCameraAt,
} from "../freeCamera/freeCamera.ts";
import {
  samplingSettings,
  type SamplingTarget,
} from "../../../../../../core/edit/sampling/sampling.ts";
import { matches } from "../../../../../../core/shortcuts/keyMatching.ts";
import { shortcutRegistry } from "../../../../../../core/shortcuts/registry.ts";
import {
  beginSamplingDrag,
  cancelSamplingDrag,
  commitSampling,
  endSamplingDrag,
  samplingSession,
  setSamplingDraft,
  type FinishSamplingResult,
} from "../../../sampling/samplingSession.ts";
import { SamplingGuideLayer } from "./SamplingGuideLayer.tsx";
import { SamplingEasingPanel } from "./SamplingEasingPanel.tsx";
import {
  anchorStagePoint,
  buildSamplingGeometry,
  sampleSamplingPointer,
  samplingSettingsForPointer,
  viewportOf,
  type SamplingGeometry,
  type SamplingPointerSample,
  type SamplingProjection,
  type SamplingViewport,
} from "./samplingGuides.ts";
const SAMPLING_HIDE_GUIDES_SHORTCUT = "sampling.hideGuides";
const SAMPLING_CANCEL_SHORTCUT = "sampling.cancel";
const EMPTY_SHORTCUT_BINDINGS: readonly never[] = [];
type GestureMode = "drag" | "camera";

/** Local overlay flags together with the target they were captured for. */
interface LocalInteraction {
  target: SamplingTarget | null;
  interaction: "idle" | GestureMode;
}

interface SamplingGesture {
  pointerId: number;
  mode: GestureMode;
  startSample?: SamplingPointerSample;
  startX?: number;
  startY?: number;
  panX?: number;
  panY?: number;
}

/** True when two projections describe the same screen geometry. */
function sameProjection(left: SamplingProjection | null, right: SamplingProjection): boolean {
  if (!left) {
    return false;
  }
  const keys: (keyof SamplingProjection)[] = [
    "stageWidth",
    "stageHeight",
    "canvasLeft",
    "canvasTop",
    "centerX",
    "centerY",
    "scaleX",
    "scaleY",
    "viewportLeft",
    "viewportTop",
    "viewportWidth",
    "viewportHeight",
    "lineX",
    "lineY",
    "lineRotation",
  ];
  return keys.every((key) => Math.abs(left[key] - right[key]) < 0.25);
}

/** Workspace sampler layer; it renders only while a sampling session is open. */
export function SamplingOverlay() {
  const runtime = useEditorRuntime();
  const session = useSyncExternalStore(
    samplingSession.subscribe,
    samplingSession.get,
    samplingSession.get,
  );
  const settings = useSyncExternalStore(
    samplingSettings.subscribe,
    samplingSettings.get,
    samplingSettings.get,
  );
  const shortcutViews = useSyncExternalStore(
    shortcutRegistry.subscribe,
    shortcutRegistry.getSnapshot,
    shortcutRegistry.getSnapshot,
  );
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<SamplingGesture | null>(null);
  const shiftHiddenRef = useRef(false);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const cursorFrame = useRef<number | null>(null);
  const target = session.target;
  const active = Boolean(target);
  const axis = target?.axis ?? null;
  const [projection, setProjection] = useState<SamplingProjection | null>(null);
  const [local, setLocal] = useState<LocalInteraction>({
    target,
    interaction: "idle",
  });
  const [shiftHidden, setShiftHidden] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const interaction = local.target === target ? local.interaction : "idle";
  const hideGuideBindings =
    shortcutViews.find((view) => view.id === SAMPLING_HIDE_GUIDES_SHORTCUT)?.bindings ??
    EMPTY_SHORTCUT_BINDINGS;
  const cancelBindings =
    shortcutViews.find((view) => view.id === SAMPLING_CANCEL_SHORTCUT)?.bindings ??
    EMPTY_SHORTCUT_BINDINGS;

  /** Set the interaction mode for the current target, resetting stale flags. */
  const setInteraction = useCallback(
    (next: "idle" | GestureMode) => {
      setLocal((previous) => ({
        target,
        interaction: next,
      }));
    },
    [target],
  );

  /** Drop the local gesture and, when asked, the in-progress draft. */
  const cancelGesture = useCallback(
    (discardDraft: boolean) => {
      const current = gesture.current;
      const wasDragging = current?.mode === "drag";
      gesture.current = null;
      setInteraction("idle");
      if (discardDraft && wasDragging) {
        cancelSamplingDrag();
      }
    },
    [setInteraction],
  );

  // The configured guide modifier temporarily hides every guide; the configured cancel key
  // floating draft before the inspector's cancel shortcut sees it. The listener
  // is attached while the stage exists so it wins the capture order once the
  // inspector pane opens.
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (hideGuideBindings.some((binding) => matches(event, binding))) {
        shiftHiddenRef.current = true;
        setShiftHidden(true);
        return;
      }
      if (!cancelBindings.some((binding) => matches(event, binding))) {
        return;
      }
      const current = samplingSession.get();
      if (!current.target || (!current.dragging && !current.locked)) {
        return;
      }
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest("input, select, textarea, [contenteditable='true']")) {
        return;
      }
      const dialog = element?.closest("[role='dialog'], [role='menu']");
      if (dialog && !dialog.closest(".sampling-float")) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelGesture(false);
      cancelSamplingDrag();
    };
    const keyup = (event: KeyboardEvent) => {
      if (hideGuideBindings.some((binding) => matches(event, binding))) {
        shiftHiddenRef.current = false;
        setShiftHidden(false);
      }
    };
    const blur = () => {
      shiftHiddenRef.current = false;
      setShiftHidden(false);
      if (gesture.current) {
        cancelGesture(gesture.current.mode === "drag");
      }
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", blur);
    };
  }, [cancelBindings, cancelGesture, hideGuideBindings]);

  // A new target is a new interaction: no pointer or camera drag from
  // the previous event may leak into it. The local flags are keyed by target,
  // so the new target already reads as idle without writing state here.
  useEffect(
    () => () => {
      gesture.current = null;
    },
    [target],
  );

  // Track the preview through every pan, zoom, and playhead step so the
  // sampler geometry matches what the renderer actually painted.
  useEffect(() => {
    if (!active || !runtime) {
      return;
    }
    let frame = 0;
    let stopped = false;
    const update = () => {
      if (stopped) {
        return;
      }
      frame = requestAnimationFrame(update);
      const preview = runtime.preview;
      const layer = root.current;
      if (!layer || !preview.viewport || !preview.chart) {
        return;
      }
      const bounds = layer.getBoundingClientRect();
      const canvasBounds = preview.canvas.getBoundingClientRect();
      const content = previewCameraView(preview.viewport, preview.camera, preview.viewDivisor ?? 1);
      let lineState: { x: number; y: number; rotation: number };
      try {
        lineState = preview.scene.sampler(preview.lastFrame?.seconds ?? 0)(target?.lineIndex ?? 0);
      } catch {
        return;
      }
      const next: SamplingProjection = {
        stageWidth: bounds.width,
        stageHeight: bounds.height,
        canvasLeft: canvasBounds.left - bounds.left,
        canvasTop: canvasBounds.top - bounds.top,
        centerX: content.centerX,
        centerY: content.centerY,
        scaleX: content.scaleX,
        scaleY: content.scaleY,
        // Sampling guides follow the camera-projected chart frame, not the
        // fixed outer canvas clip. This is the actual screen boundary used by
        // the outside-frame fade while zooming or panning.
        viewportLeft: canvasBounds.left - bounds.left + content.left,
        viewportTop: canvasBounds.top - bounds.top + content.top,
        viewportWidth: content.width,
        viewportHeight: content.height,
        lineX: canvasBounds.left - bounds.left + content.centerX + lineState.x * content.scaleX,
        lineY: canvasBounds.top - bounds.top + content.centerY - lineState.y * content.scaleY,
        lineRotation: lineState.rotation,
      };
      setProjection((previous) => (sameProjection(previous, next) ? previous : next));
    };
    frame = requestAnimationFrame(update);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [active, runtime, target?.lineIndex]);

  // Cursor reveal is published on animation frames, keeping native pointer
  // movement from scheduling a React render for every event.
  useEffect(
    () => () => {
      if (cursorFrame.current !== null) {
        cancelAnimationFrame(cursorFrame.current);
        cursorFrame.current = null;
      }
    },
    [],
  );

  // Keep the sampled line visually selected so a busy chart still shows which
  // line the anchors belong to.
  useEffect(() => {
    if (!active || !target || !runtime) {
      return;
    }
    const preview = runtime.preview;
    const color =
      preview.selectedLineColor.length >= 3 ? [...preview.selectedLineColor] : [0, 200, 0];
    preview.setSamplingFocus({ lineIndex: target.lineIndex, color });
    return () => preview.setSamplingFocus(null);
  }, [active, runtime, target]);

  // Opacity is the one sampled value with a live renderer preview; it follows
  // the drag's end anchor and disappears as soon as the drag ends.
  const alphaEnd = session.draft.end;
  const alphaPreview = session.dragging && alphaEnd?.axis === "alpha" ? alphaEnd.scalar : null;
  useEffect(() => {
    if (!active || !target || !runtime || axis !== "alpha") {
      return;
    }
    if (alphaPreview === null) {
      runtime.preview.setSamplingAlpha(null);
      return;
    }
    runtime.preview.setSamplingAlpha({ lineIndex: target.lineIndex, alpha: alphaPreview });
    return () => runtime.preview.setSamplingAlpha(null);
  }, [active, alphaPreview, axis, runtime, target]);

  // Wheel zoom stays available while sampling. Wheel events over the floating
  // panel scroll its body instead of moving the camera.
  useEffect(() => {
    const layer = root.current;
    if (!active || !layer) {
      return;
    }
    const wheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest(".sampling-float")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const deltaY = wheelZoomDelta(event.deltaY, event.deltaMode);
      if (deltaY === 0) {
        return;
      }
      const bounds = layer.getBoundingClientRect();
      zoomFreeCameraAt(
        event.clientX - bounds.left - bounds.width / 2,
        event.clientY - bounds.top - bounds.height / 2,
        deltaY,
      );
    };
    layer.addEventListener("wheel", wheel, { passive: false });
    return () => layer.removeEventListener("wheel", wheel);
  }, [active]);

  if (!target || !runtime) {
    return null;
  }

  const draft = session.draft;
  const geometry: SamplingGeometry | null = projection
    ? buildSamplingGeometry(projection, target.axis, settings)
    : null;
  const viewport: SamplingViewport | null = projection ? viewportOf(projection) : null;
  const startPoint =
    projection && geometry && draft.start ? anchorStagePoint(draft.start, projection) : null;
  const endPoint =
    projection && geometry && draft.end ? anchorStagePoint(draft.end, projection) : null;
  const showGuides = settings.guidesEnabled && !shiftHidden;
  // Anchor points and the drag path are part of the sample, not the guide grid.
  // They remain visible while Shift temporarily hides the grid.
  const showAnchors = Boolean(startPoint || endPoint);
  const midpoint =
    startPoint && endPoint
      ? { x: (startPoint.x + endPoint.x) / 2, y: (startPoint.y + endPoint.y) / 2 }
      : viewport
        ? { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2 }
        : { x: 0, y: 0 };

  /** Recompute one pointer sample from the current projection. */
  const sampleAt = (clientX: number, clientY: number): SamplingPointerSample | null => {
    const layer = root.current;
    if (!layer || !projection) {
      return null;
    }
    return sampleSamplingPointer(
      clientX,
      clientY,
      layer.getBoundingClientRect(),
      projection,
      target.axis,
      samplingSettingsForPointer(settings, shiftHiddenRef.current),
    );
  };

  /** Publish the latest stage-local pointer position on the next frame. */
  const updateCursor = (clientX: number, clientY: number): void => {
    const layer = root.current;
    if (!layer) {
      return;
    }
    const bounds = layer.getBoundingClientRect();
    cursorRef.current = { x: clientX - bounds.left, y: clientY - bounds.top };
    if (cursorFrame.current !== null) {
      return;
    }
    cursorFrame.current = requestAnimationFrame(() => {
      cursorFrame.current = null;
      setCursor(cursorRef.current);
    });
  };

  /** Hide the radial reveal after the pointer leaves the stage. */
  const clearCursor = (): void => {
    cursorRef.current = null;
    if (cursorFrame.current !== null) {
      cancelAnimationFrame(cursorFrame.current);
      cursorFrame.current = null;
    }
    setCursor(null);
  };

  /** Commit the locked draft and report the core result to the panel. */
  const commitDraft = (): FinishSamplingResult => commitSampling(runtime.session);

  /** Discard both anchors and leave the sampler idle on the same event. */
  const discardDraft = () => {
    cancelSamplingDrag();
  };

  return (
    <div
      ref={root}
      className="sampling-overlay"
      data-axis={target.axis}
      data-interaction={interaction}
      data-guides-hidden={shiftHidden ? "true" : undefined}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        updateCursor(event.clientX, event.clientY);
        if (event.target instanceof Element && event.target.closest(".sampling-float")) {
          return;
        }
        event.stopPropagation();
        if (event.button === 1) {
          event.preventDefault();
          return;
        }
        if (event.button === 2 && isFreeCameraDragButton(event.button) && !gesture.current) {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const camera = freeCameraState.get();
          gesture.current = {
            pointerId: event.pointerId,
            mode: "camera",
            startX: event.clientX,
            startY: event.clientY,
            panX: camera.panX,
            panY: camera.panY,
          };
          setInteraction("camera");
          return;
        }
        if (event.button !== 0 || session.locked || gesture.current) {
          return;
        }
        const sample = sampleAt(event.clientX, event.clientY);
        if (!sample) {
          return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const pointerId = event.pointerId;
        const next: SamplingGesture = { pointerId, startSample: sample, mode: "drag" };
        gesture.current = next;
        setInteraction("drag");
        beginSamplingDrag();
        setSamplingDraft(sample.value, sample.value);
      }}
      onPointerMove={(event) => {
        updateCursor(event.clientX, event.clientY);
        event.stopPropagation();
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) {
          return;
        }
        event.preventDefault();
        if (current.mode === "camera") {
          setFreeCameraView(
            freeCameraState.get().zoom,
            (current.panX ?? 0) + event.clientX - (current.startX ?? event.clientX),
            (current.panY ?? 0) + event.clientY - (current.startY ?? event.clientY),
          );
          return;
        }
        const sample = sampleAt(event.clientX, event.clientY);
        if (sample && current.startSample) {
          setSamplingDraft(current.startSample.value, sample.value);
        }
      }}
      onPointerUp={(event) => {
        updateCursor(event.clientX, event.clientY);
        event.stopPropagation();
        const current = gesture.current;
        if (current?.pointerId === event.pointerId) {
          if (current.mode === "drag" && current.startSample) {
            const sample = sampleAt(event.clientX, event.clientY);
            if (sample) {
              setSamplingDraft(current.startSample.value, sample.value);
            }
            endSamplingDrag();
          }
          gesture.current = null;
          setInteraction("idle");
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={(event) => {
        updateCursor(event.clientX, event.clientY);
        event.stopPropagation();
        const current = gesture.current;
        if (current?.pointerId === event.pointerId) {
          cancelGesture(current.mode === "drag");
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onLostPointerCapture={(event) => {
        const current = gesture.current;
        if (current?.pointerId === event.pointerId) {
          cancelGesture(current.mode === "drag");
        }
      }}
      onPointerLeave={() => {
        if (!gesture.current) {
          clearCursor();
        }
      }}
    >
      {projection && viewport && geometry && (
        <SamplingGuideLayer
          projection={projection}
          viewport={viewport}
          geometry={geometry}
          start={draft.start}
          end={draft.end}
          startPoint={startPoint}
          endPoint={endPoint}
          showGuides={showGuides}
          showAnchors={showAnchors}
          cursor={cursor}
          dragging={session.dragging}
          guideOpacity={settings.guideOpacity / 100}
        />
      )}

      {viewport && session.locked && !session.dragging && draft.start && draft.end && (
        <SamplingEasingPanel
          session={session}
          viewport={viewport}
          anchor={midpoint}
          onCommit={commitDraft}
          onDiscard={discardDraft}
        />
      )}
    </div>
  );
}
