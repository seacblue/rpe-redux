/**
 * The free-camera pointer surface and its floating reset dock.
 *
 * While active, the stage shows only the preview underlay. The wheel zooms the
 * chart camera around the pointer, and dragging pans it in screen pixels. The
 * renderer redraws the chart content, background, and chart-frame outline for
 * that view inside the fixed preview clip; only the camera state lives here.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconButton } from "../../../../../../design/components/button/IconButton.tsx";
import { Input } from "../../../../../../design/components/input/Input.tsx";
import { useTranslation } from "../../../../../../i18n/react.ts";
import {
  freeCameraState,
  isFreeCameraDragButton,
  resetFreeCamera,
  setFreeCameraView,
  wheelZoomDelta,
  zoomFreeCameraAt,
} from "./freeCamera.ts";

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  panX: number;
  panY: number;
}

interface FreeCameraOverlayProps {
  /** Whether this mode may change pan by pointer dragging. */
  allowDragging?: boolean;
}

/** Format a camera value without exposing floating-point noise in the dock. */
function formatCameraValue(value: number): string {
  return String(Number.isInteger(value) ? value : Number(value.toFixed(2)));
}

/** Renders the free-camera pointer surface while the mode is active. */
export function FreeCameraOverlay({ allowDragging = true }: FreeCameraOverlayProps) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(
    freeCameraState.subscribe,
    freeCameraState.get,
    freeCameraState.get,
  );
  const layer = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [panning, setPanning] = useState(false);
  const [zoomDraft, setZoomDraft] = useState<string | null>(null);
  const [panXDraft, setPanXDraft] = useState<string | null>(null);
  const [panYDraft, setPanYDraft] = useState<string | null>(null);
  const zoomInput = zoomDraft ?? formatCameraValue(state.zoom * 100);
  const panXInput = panXDraft ?? formatCameraValue(state.panX);
  const panYInput = panYDraft ?? formatCameraValue(state.panY);

  useEffect(() => {
    if (allowDragging || !drag.current) {
      return;
    }
    drag.current = null;
    setPanning(false);
  }, [allowDragging]);

  /** Commit the zoom percentage typed into the dock. */
  const commitZoom = (): void => {
    const value = Number(zoomInput);
    if (zoomInput.trim() !== "" && Number.isFinite(value)) {
      setFreeCameraView(value / 100, state.panX, state.panY);
    }
    setZoomDraft(null);
  };

  /** Commit the horizontal pan typed into the dock. */
  const commitPanX = (): void => {
    const value = Number(panXInput);
    if (panXInput.trim() !== "" && Number.isFinite(value)) {
      setFreeCameraView(state.zoom, value, state.panY);
    }
    setPanXDraft(null);
  };

  /** Commit the vertical pan typed into the dock. */
  const commitPanY = (): void => {
    const value = Number(panYInput);
    if (panYInput.trim() !== "" && Number.isFinite(value)) {
      setFreeCameraView(state.zoom, state.panX, value);
    }
    setPanYDraft(null);
  };

  useEffect(() => {
    const element = layer.current;
    if (!element || !state.active) {
      return;
    }
    /** Zooms around the pointer's position within the layer. */
    const wheel = (event: WheelEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const deltaY = wheelZoomDelta(event.deltaY, event.deltaMode);
      if (deltaY === 0) {
        return;
      }
      const bounds = element.getBoundingClientRect();
      zoomFreeCameraAt(
        event.clientX - bounds.left - bounds.width / 2,
        event.clientY - bounds.top - bounds.height / 2,
        deltaY,
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [state.active]);

  if (!state.active) {
    return null;
  }

  return (
    <div
      ref={layer}
      className="free-camera-layer"
      data-panning={panning ? "true" : undefined}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        if (
          !allowDragging ||
          !isFreeCameraDragButton(event.button) ||
          (event.target instanceof Element && event.target.closest(".free-camera-dock"))
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const current = freeCameraState.get();
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          panX: current.panX,
          panY: current.panY,
        };
        setPanning(true);
      }}
      onPointerMove={(event) => {
        if (!allowDragging) {
          return;
        }
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setFreeCameraView(
          freeCameraState.get().zoom,
          active.panX + event.clientX - active.startX,
          active.panY + event.clientY - active.startY,
        );
      }}
      onPointerUp={(event) => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) {
          return;
        }
        drag.current = null;
        setPanning(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={(event) => {
        drag.current = null;
        setPanning(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
    >
      <div className="free-camera-dock" role="group">
        <label className="free-camera-field">
          <span>{t("chrome.toolbar.freeCameraZoom")}</span>
          <Input
            type="number"
            step="any"
            value={zoomInput}
            aria-label={t("chrome.toolbar.freeCameraZoom")}
            textAlign="right"
            onChange={(event) => setZoomDraft(event.currentTarget.value)}
            onBlur={commitZoom}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
          <span className="free-camera-unit">%</span>
        </label>
        <label className="free-camera-field">
          <span>{t("chrome.toolbar.freeCameraPanX")}</span>
          <Input
            type="number"
            step="any"
            value={panXInput}
            aria-label={t("chrome.toolbar.freeCameraPanX")}
            textAlign="right"
            onChange={(event) => setPanXDraft(event.currentTarget.value)}
            onBlur={commitPanX}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <label className="free-camera-field">
          <span>{t("chrome.toolbar.freeCameraPanY")}</span>
          <Input
            type="number"
            step="any"
            value={panYInput}
            aria-label={t("chrome.toolbar.freeCameraPanY")}
            textAlign="right"
            onChange={(event) => setPanYDraft(event.currentTarget.value)}
            onBlur={commitPanY}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <IconButton
          className="free-camera-reset"
          icon="refresh"
          size="small"
          label={t("chrome.toolbar.freeCameraReset")}
          onClick={resetFreeCamera}
        />
      </div>
    </div>
  );
}
