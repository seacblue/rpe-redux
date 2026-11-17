/** Curve trajectory overlay: paints the draft, handles pointer tools, and hosts the tool rail. */
/* eslint-disable max-lines -- pointer tools, preview, drawing, and keyboard wiring share one canvas surface. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useEditorRuntime } from "../workspace/runtime/composition/EditorRuntime.tsx";
import { closeInspector } from "../inspector/controller.ts";
import { t } from "../../../../i18n/index.ts";
import {
  componentEndpoints,
  componentFromNodes,
  connectEndpoints,
  fitStroke,
  reverseComponent,
  subdivideComponent,
  type CurvePathPoint,
} from "./pathModel.ts";
import { rotateComponent } from "./pathGeometry.ts";
import { CurveToolDock } from "./CurveToolDock.tsx";
import { curvePreviewMode } from "./mode.ts";
import { closeCurvePane } from "./paneSession.ts";
import { CURVE_CREATION_TOOLS, type CurveTool } from "./curveTools.ts";
import {
  beginCurveEdit,
  bindCurveGestures,
  clearCurveHistory,
  curveActiveComponents,
  curveActiveTarget,
  curvePreviewState,
  updateCurvePreview,
} from "./store.ts";
import { CURVE_HIT_RADIUS, pickCurveTarget } from "./curveHitTest.ts";
import {
  curveEditPoint,
  curveGridSpacing,
  drawCurveOverlay,
  drawCurvePreviewMarker,
  moveHandle,
  overlayToWorld,
  previewOverlayView,
  rotationGeometry,
  type OverlayHandle,
} from "./drawOverlay.ts";
import { deleteCurveSelection } from "./selection.ts";
import {
  freeCameraState,
  setFreeCameraView,
  zoomFreeCameraAt,
} from "../workspace/stage/freeCamera/freeCamera.ts";
import {
  finishesOnDoubleClick,
  TOOL_HINTS,
  translateComponent,
  type CanvasDrag,
  type Draft,
  type PanDrag,
} from "./overlayModel.ts";
import { useCurvePreviewPlayback } from "./useCurvePreviewPlayback.ts";
import { useCurveOverlayKeyboard } from "./useCurveOverlayKeyboard.ts";
import { useCurveToolDock } from "./useCurveToolDock.ts";
import { samplePreviewMarker } from "./previewSampling.ts";
import { applyCurveWheelZoom } from "./curveWheel.ts";
import { useTimelineDomSurface } from "../workspace/timeline/surface/TimelineDomSurface.tsx";

/** Tools that create a path; path handles remain hidden while one is active. */
const CREATION_TOOLS: ReadonlySet<CurveTool> = new Set(
  CURVE_CREATION_TOOLS.map((entry) => entry.id),
);

interface CurveHover {
  componentId: string;
  segmentIndex: number | null;
}

/** Compare hover targets without re-rendering when both are equal. */
function sameHover(left: CurveHover | null, right: CurveHover | null): boolean {
  return (
    left === right ||
    (Boolean(left && right) &&
      left?.componentId === right?.componentId &&
      left?.segmentIndex === right?.segmentIndex)
  );
}

/** Compare handles by address so equal hover targets do not re-render. */
function sameHandle(left: OverlayHandle | null, right: OverlayHandle | null): boolean {
  return (
    left === right ||
    (Boolean(left && right) &&
      left?.segmentIndex === right?.segmentIndex &&
      left?.field === right?.field)
  );
}

/** Stage overlay for curve authoring: paints the draft, handles pointer tools, and hosts the tool dock. */
export function CurveEventsOverlay() {
  const {
    refs: { stage },
  } = useTimelineDomSurface();
  const runtime = useEditorRuntime();
  const active = useSyncExternalStore(
    curvePreviewMode.subscribe,
    curvePreviewMode.get,
    curvePreviewMode.get,
  );
  const draftState = useSyncExternalStore(
    curvePreviewState.subscribe,
    curvePreviewState.get,
    curvePreviewState.get,
  );
  const camera = useSyncExternalStore(
    freeCameraState.subscribe,
    freeCameraState.get,
    freeCameraState.get,
  );
  const canvas = useRef<HTMLCanvasElement>(null);
  const markerCanvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const dragCanvas = useRef<CanvasDrag | null>(null);
  const panDrag = useRef<PanDrag | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const gridHover = useRef<CurvePathPoint | null>(null);
  const drawRef = useRef<(() => void) | null>(null);
  const drawMarkerRef = useRef<((progress: number) => void) | null>(null);
  const progressRef = useRef(0);
  const [activeHandle, setActiveHandle] = useState<OverlayHandle | null>(null);
  const [hoveredHandle, setHoveredHandle] = useState<OverlayHandle | null>(null);
  const [hover, setHover] = useState<CurveHover | null>(null);
  const [connectFirstId, setConnectFirstId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tool, setTool] = useState<CurveTool>("select");
  const { position, beginDrag: beginToolDockDrag } = useCurveToolDock(layer);
  const {
    components,
    selectedId,
    selectedSegment,
    editMode,
    gridEnabled,
    gridDistance,
    previewProgress,
  } = draftState;
  const gridSpacing = curveGridSpacing(Number(gridDistance));
  const drawing = editMode === "draw";
  const activeComponents = curveActiveComponents(draftState);
  const showSelection = drawing && !CREATION_TOOLS.has(tool);
  const previewTarget = curveActiveTarget(draftState) ?? activeComponents[0] ?? null;

  /**
   * One view for drawing, the chart underlay, and the preview marker.
   *
   * The chart's presentation frame scales X and Y independently, so the editor
   * uses the same mapping to keep authored shapes matching the preview.
   */
  const viewFor = useCallback(
    (element: HTMLCanvasElement) =>
      previewOverlayView(element, runtime?.preview.aspectRatio, runtime?.preview.viewDivisor, {
        ...camera,
        active: true,
      }),
    [camera, runtime],
  );

  const setStatus = (message: string) => updateCurvePreview({ status: message });

  /** Drop the transient stroke, connector, drag, pan, and hover state. */
  const cancelGestures = useCallback(() => {
    draftRef.current = null;
    dragCanvas.current = null;
    panDrag.current = null;
    setDraft(null);
    setConnectFirstId(null);
    setActiveHandle(null);
    setHoveredHandle(null);
    setHover(null);
  }, []);

  /**
   * Close the inspection pane that owns this surface.
   *
   * The pane lifecycle flushes the draft and returns the borrowed camera; the
   * direct close keeps the surface closed when the pane was already cleared by
   * another surface.
   */
  const close = useCallback(() => {
    clearCurveHistory();
    if (runtime) {
      closeInspector(runtime.ui.activeInspector);
    }
    closeCurvePane();
  }, [runtime]);

  /** Delete the selected segment or path, then clear gesture state. */
  const deleteSelected = useCallback(() => {
    const current = curvePreviewState.get();
    if (current.editMode !== "draw") {
      return;
    }
    const result = deleteCurveSelection(
      current.components,
      current.selectedId,
      current.selectedSegment,
    );
    if (!result.removed) {
      updateCurvePreview({ status: t("editorPanels.curvePreview.deleteNoSelection") });
      return;
    }
    beginCurveEdit();
    updateCurvePreview({
      components: result.components,
      selectedId: result.selectedId,
      selectedSegment: result.selectedSegment,
      status: t(
        result.removed === "segment"
          ? "editorPanels.curvePreview.segmentDeleted"
          : "editorPanels.curvePreview.pathDeleted",
      ),
    });
    setConnectFirstId(null);
    setActiveHandle(null);
    setHoveredHandle(null);
    setHover(null);
  }, []);

  // The pane lifecycle owns the camera the surface draws through: it borrows the
  // saved view on open and returns it on close. This overlay only reads the view.

  // A mode switch must not leave a half-finished draft or connector behind.
  useEffect(
    () =>
      bindCurveGestures({
        hasPending: () =>
          draftRef.current !== null || dragCanvas.current !== null || panDrag.current !== null,
        cancel: cancelGestures,
        deleteSelected,
      }),
    [cancelGestures, deleteSelected],
  );

  // Hiding the surface removes its canvas, so no pointer-up can end an active
  // stroke, drag, or pan. The cleanup runs on deactivation and on unmount.
  useEffect(() => () => cancelGestures(), [active, cancelGestures]);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!active || !element) {
      drawRef.current = null;
      return;
    }
    const draw = () => {
      drawCurveOverlay(element, {
        components: activeComponents,
        selectedId: drawing ? selectedId : null,
        selectedSegment: drawing ? selectedSegment : null,
        activeHandle: showSelection ? activeHandle : null,
        hoveredHandle: showSelection ? hoveredHandle : null,
        hover: showSelection ? hover : null,
        connectFirstId: showSelection ? connectFirstId : null,
        draft: drawing ? draft : null,
        gridDistance: gridEnabled ? gridSpacing : null,
        gridHover: gridEnabled ? gridHover.current : null,
        view: viewFor(element),
        showHandles: showSelection,
        selectionFrame: showSelection && tool === "select",
        frame: true,
      });
    };
    drawRef.current = draw;
    draw();
    return () => {
      if (drawRef.current === draw) {
        drawRef.current = null;
      }
    };
  }, [
    active,
    activeComponents,
    activeHandle,
    connectFirstId,
    draft,
    drawing,
    gridEnabled,
    gridSpacing,
    hover,
    hoveredHandle,
    selectedId,
    selectedSegment,
    showSelection,
    tool,
    viewFor,
  ]);

  /** Paint the transport marker without updating the shared store. */
  const drawMarker = useCallback(
    (progress: number) => {
      progressRef.current = progress;
      if (layer.current) {
        layer.current.dataset.previewProgress = progress.toFixed(4);
      }
      const element = markerCanvas.current;
      if (!element) {
        return;
      }
      const position = previewTarget
        ? samplePreviewMarker(previewTarget, draftState.tEasing, progress)
        : null;
      drawCurvePreviewMarker(element, { view: viewFor(element), position });
    },
    [draftState.tEasing, previewTarget, viewFor],
  );

  useLayoutEffect(() => {
    drawMarkerRef.current = drawMarker;
    drawMarker(previewProgress);
    return () => {
      if (drawMarkerRef.current === drawMarker) {
        drawMarkerRef.current = null;
      }
    };
  }, [drawMarker, previewProgress]);

  // Size changes are the only reason to rebuild the observer; playback frames
  // reuse the latest draw callbacks without re-rendering this component.
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!active || !element) {
      return;
    }
    const observer = new ResizeObserver(() => {
      drawRef.current?.();
      drawMarkerRef.current?.(progressRef.current);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);

  useCurvePreviewPlayback({
    active,
    previewLineOnly: draftState.previewLineOnly,
    runtime,
    onProgress: drawMarker,
  });

  // The wheel is one navigation gesture for the whole curve surface; the native
  // listener can prevent the page from scrolling.
  useEffect(() => {
    if (!gridEnabled || !drawing) {
      gridHover.current = null;
    }
  }, [drawing, gridEnabled]);

  useLayoutEffect(() => {
    if (!active) {
      return;
    }
    // Curve mode owns every wheel over the stage, including equation mode where
    // the canvas ignores pointers. The window capture runs before the stage's
    // timeline route, so the gesture never seeks or switches lines; the target
    // filter keeps wheels over the inspector and other surfaces untouched.
    const wheel = (event: WheelEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !stage.current?.contains(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const element = canvas.current;
      if (!element) {
        return;
      }
      applyCurveWheelZoom(
        {
          clientX: event.clientX,
          clientY: event.clientY,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          bounds: element.getBoundingClientRect(),
          overToolDock: Boolean(target.closest(".curve-tool-dock")),
        },
        zoomFreeCameraAt,
      );
    };
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", wheel, { capture: true });
  }, [active, stage]);

  /** Clear path and segment selection plus transient hover state. */
  function clearSelection(): void {
    updateCurvePreview({ selectedId: null, selectedSegment: null });
    setConnectFirstId(null);
    setActiveHandle(null);
    setHoveredHandle(null);
    setHover(null);
  }

  useCurveOverlayKeyboard({
    active,
    drawing,
    selectedId,
    selectedSegment,
    tool,
    connectFirstId,
    hasDraft: () => draftRef.current !== null,
    cancelDraft: () => {
      draftRef.current = null;
      setDraft(null);
    },
    cancelConnect: () => setConnectFirstId(null),
    clearSelection,
    close,
  });

  if (!active || !runtime) {
    return null;
  }

  /** Convert a pointer event to chart coordinates without grid snapping. */
  const rawPointFor = (event: { clientX: number; clientY: number }): CurvePathPoint | null => {
    const element = canvas.current;
    if (!element) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return overlayToWorld(viewFor(element), {
      x: ((event.clientX - rect.left) * element.clientWidth) / rect.width,
      y: ((event.clientY - rect.top) * element.clientHeight) / rect.height,
    });
  };

  /** Convert a pointer event to an authoring point, snapped while the grid is on. */
  const editPointFor = (event: { clientX: number; clientY: number }): CurvePathPoint | null => {
    const raw = rawPointFor(event);
    if (!raw) {
      return null;
    }
    return curveEditPoint(raw, gridEnabled, gridSpacing);
  };

  /** Publish hover state only when it changed and update the canvas cursor. */
  const updateHover = (
    next: CurveHover | null,
    handle: OverlayHandle | null,
    cursor: string,
  ): void => {
    setHover((current) => (sameHover(current, next) ? current : next));
    setHoveredHandle((current) => (sameHandle(current, handle) ? current : handle));
    const element = canvas.current;
    if (element) {
      element.style.cursor = cursor;
    }
  };

  /** Handle one connect click: choose the first path, then merge with the second. */
  const handleConnect = (point: CurvePathPoint) => {
    const view = viewFor(canvas.current!);
    const pick = pickCurveTarget({
      components,
      selectedId: null,
      point,
      view,
      radius: CURVE_HIT_RADIUS,
    });
    const hit =
      pick.kind === "path" ? components.find((entry) => entry.id === pick.componentId) : undefined;
    if (!hit) {
      setConnectFirstId(null);
      setStatus(t("editorPanels.curvePreview.connectNeedTwo"));
      return;
    }
    if (!connectFirstId) {
      setConnectFirstId(hit.id);
      updateCurvePreview({
        selectedId: hit.id,
        selectedSegment: null,
        status: t("editorPanels.curvePreview.connectFirst"),
      });
      return;
    }
    if (connectFirstId === hit.id) {
      setConnectFirstId(null);
      setStatus(t("editorPanels.curvePreview.connectNeedTwo"));
      return;
    }
    const first = components.find((component) => component.id === connectFirstId);
    const firstEndpoints = first ? componentEndpoints(first) : null;
    const secondEndpoints = componentEndpoints(hit);
    if (!first || !firstEndpoints || !secondEndpoints) {
      setConnectFirstId(null);
      return;
    }
    const next = connectEndpoints(
      components,
      { componentId: first.id, atStart: false, point: firstEndpoints[1] },
      { componentId: hit.id, atStart: true, point: secondEndpoints[0] },
    );
    beginCurveEdit();
    updateCurvePreview({
      components: next,
      selectedId: first.id,
      selectedSegment: null,
      status: t("editorPanels.curvePreview.connected"),
    });
    setConnectFirstId(null);
    setActiveHandle(null);
  };

  /** Split the clicked segment at the pointer's progress. */
  const handleSubdivide = (point: CurvePathPoint) => {
    const element = canvas.current;
    if (!element) {
      return;
    }
    const pick = pickCurveTarget({
      components,
      selectedId: null,
      point,
      view: viewFor(element),
      radius: CURVE_HIT_RADIUS,
    });
    const component =
      pick.kind === "path" ? components.find((entry) => entry.id === pick.componentId) : undefined;
    if (pick.kind !== "path" || !component) {
      setStatus(t(TOOL_HINTS.subdivide));
      return;
    }
    const next = subdivideComponent(component, pick.segmentIndex, pick.progress);
    beginCurveEdit();
    updateCurvePreview((current) => ({
      components: current.components.map((entry) => (entry.id === next.id ? next : entry)),
      selectedId: next.id,
      selectedSegment: null,
      status: t("editorPanels.curvePreview.subdivided"),
    }));
    setActiveHandle(null);
  };

  /** Reverse the selected path's direction. */
  const reverseSelected = () => {
    const selected = components.find((component) => component.id === selectedId);
    if (!selected) {
      setStatus(t("editorPanels.curvePreview.reverseNoSelection"));
      return;
    }
    beginCurveEdit();
    updateCurvePreview((current) => ({
      components: current.components.map((component) =>
        component.id === selected.id ? reverseComponent(component) : component,
      ),
      selectedSegment: null,
      status: t("editorPanels.curvePreview.reversed"),
    }));
    setConnectFirstId(null);
    setActiveHandle(null);
  };

  /** Start a new pencil, line, polyline, or curve draft at `point`. */
  const beginDraft = (kind: Draft["kind"], point: CurvePathPoint) => {
    const next: Draft = {
      kind,
      points: kind === "line" ? [point, point] : [point],
    };
    draftRef.current = next;
    setDraft(next);
    setConnectFirstId(null);
    setActiveHandle(null);
    setStatus(t(TOOL_HINTS[kind]));
  };

  /** Add a clicked node to a polyline or curve draft, ignoring near-duplicates. */
  const appendDraftPoint = (kind: "polyline" | "curve", point: CurvePathPoint) => {
    const current = draftRef.current;
    if (!current || current.kind !== kind) {
      beginDraft(kind, point);
      return;
    }
    const last = current.points.at(-1);
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 2) {
      return;
    }
    const next = { ...current, points: [...current.points, point] };
    draftRef.current = next;
    setDraft(next);
  };

  /** Commit the current draft as a component when it has enough points. */
  const finishDraft = () => {
    const current = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!current) {
      return;
    }
    if (current.kind === "pencil") {
      const component = fitStroke(current.points);
      if (!component) {
        setStatus(t("editorPanels.curvePreview.pencilTooShort"));
        return;
      }
      beginCurveEdit();
      updateCurvePreview((state) => ({
        components: [...state.components, component],
        selectedId: component.id,
        selectedSegment: null,
        status: t("editorPanels.curvePreview.pencilCreated"),
      }));
      return;
    }
    const name = t(
      current.kind === "line"
        ? "editorPanels.curvePreview.linePath"
        : current.kind === "polyline"
          ? "editorPanels.curvePreview.polylinePath"
          : "editorPanels.curvePreview.curvePath",
    );
    const component = componentFromNodes(name, current.points, {
      smooth: current.kind === "curve",
    });
    if (!component) {
      setStatus(t("editorPanels.curvePreview.pathTooShort"));
      return;
    }
    beginCurveEdit();
    updateCurvePreview((state) => ({
      components: [...state.components, component],
      selectedId: component.id,
      selectedSegment: null,
      status: t("editorPanels.curvePreview.pathCreated", { name }),
    }));
  };

  /** Start dragging the canvas from anywhere the tool does not claim the press. */
  const beginPan = (event: ReactPointerEvent<HTMLCanvasElement>, deselectOnClick: boolean) => {
    const current = freeCameraState.get();
    panDrag.current = {
      startX: event.clientX,
      startY: event.clientY,
      panX: current.panX,
      panY: current.panY,
      moved: false,
      deselectOnClick,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; synthetic test events have no active pointer.
    }
  };

  /** Route right/middle presses to panning and left presses to the active tool. */
  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button === 2) {
      event.preventDefault();
      beginPan(event, false);
      return;
    }
    if (event.button === 1) {
      event.preventDefault();
      beginPan(event, false);
      return;
    }
    if (event.button !== 0) {
      return;
    }
    const raw = rawPointFor(event);
    if (!raw) {
      return;
    }
    if (!drawing) {
      return;
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; synthetic test events have no active pointer.
    }
    const element = event.currentTarget;
    const view = viewFor(element);

    if (tool === "pencil" || tool === "line") {
      const point = editPointFor(event);
      if (point) {
        beginDraft(tool, point);
      }
      return;
    }
    if (tool === "polyline" || tool === "curve") {
      const point = editPointFor(event);
      if (point) {
        appendDraftPoint(tool, point);
      }
      return;
    }
    if (tool === "connect") {
      handleConnect(raw);
      return;
    }
    if (tool === "subdivide") {
      handleSubdivide(raw);
      return;
    }

    const pick = pickCurveTarget({ components, selectedId, point: raw, view });
    if (pick.kind === "rotate" && selectedId) {
      const selected = components.find((component) => component.id === selectedId);
      const rotation = selected ? rotationGeometry(selected, view) : null;
      if (rotation) {
        setActiveHandle(null);
        setHoveredHandle(null);
        dragCanvas.current = {
          kind: "rotate",
          componentId: selectedId,
          center: rotation.center,
          lastAngle: Math.atan2(raw.y - rotation.center.y, raw.x - rotation.center.x),
        };
        return;
      }
    }
    if (pick.kind === "handle" && selectedId) {
      setActiveHandle(pick.handle);
      setHoveredHandle(pick.handle);
      dragCanvas.current = {
        kind: "handle",
        componentId: selectedId,
        handle: pick.handle,
      };
      return;
    }
    if (pick.kind === "frame" && selectedId) {
      dragCanvas.current = {
        kind: "component",
        componentId: selectedId,
        last: editPointFor(event) ?? raw,
      };
      return;
    }
    if (pick.kind === "path") {
      setActiveHandle(null);
      setHoveredHandle(null);
      if (pick.componentId !== selectedId) {
        updateCurvePreview({
          selectedId: pick.componentId,
          selectedSegment: null,
        });
        return;
      }
      updateCurvePreview({
        selectedId: pick.componentId,
        selectedSegment: {
          componentId: pick.componentId,
          segmentIndex: pick.segmentIndex,
        },
      });
      return;
    }
    beginPan(event, true);
  };

  /** Update a pan, draft, drag, or hover from the pointer's new position. */
  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pan = panDrag.current;
    if (pan) {
      const dx = event.clientX - pan.startX;
      const dy = event.clientY - pan.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        pan.moved = true;
      }
      setFreeCameraView(freeCameraState.get().zoom, pan.panX + dx, pan.panY + dy);
      return;
    }
    const point = rawPointFor(event);
    if (!point) {
      return;
    }
    if (gridEnabled) {
      gridHover.current = point;
      drawRef.current?.();
    }
    if (!drawing) {
      return;
    }
    const currentDraft = draftRef.current;
    if (currentDraft) {
      if (currentDraft.kind === "line") {
        const end = editPointFor(event) ?? point;
        const next = { ...currentDraft, points: [currentDraft.points[0], end] };
        draftRef.current = next;
        setDraft(next);
        return;
      }
      if (currentDraft.kind === "polyline" || currentDraft.kind === "curve") {
        return;
      }
      const last = currentDraft.points.at(-1);
      // Freehand sampling is coarser than the pointer rate; the stroke is
      // simplified afterwards and smaller samples keep undo snapshots light.
      if (last && Math.hypot(point.x - last.x, point.y - last.y) < 4) {
        return;
      }
      const next = { ...currentDraft, points: [...currentDraft.points, point] };
      draftRef.current = next;
      setDraft(next);
      return;
    }
    const drag = dragCanvas.current;
    if (!drag) {
      const element = event.currentTarget;
      const pick = pickCurveTarget({
        components,
        selectedId,
        point,
        view: viewFor(element),
      });
      if (pick.kind === "handle") {
        updateHover(
          selectedId ? { componentId: selectedId, segmentIndex: pick.handle.segmentIndex } : null,
          pick.handle,
          "pointer",
        );
      } else if (pick.kind === "rotate") {
        updateHover(
          selectedId ? { componentId: selectedId, segmentIndex: null } : null,
          null,
          "grab",
        );
      } else if (pick.kind === "frame") {
        updateHover(
          selectedId ? { componentId: selectedId, segmentIndex: null } : null,
          null,
          "move",
        );
      } else if (pick.kind === "path") {
        updateHover(
          {
            componentId: pick.componentId,
            segmentIndex: pick.componentId === selectedId ? pick.segmentIndex : null,
          },
          null,
          "pointer",
        );
      } else {
        updateHover(null, null, tool === "select" ? "default" : "crosshair");
      }
      return;
    }
    if (drag.kind === "handle" && drag.handle) {
      const target = editPointFor(event) ?? point;
      if (!drag.tracked) {
        drag.tracked = true;
        beginCurveEdit();
      }
      updateCurvePreview((current) => ({
        components: current.components.map((component) =>
          component.id === drag.componentId
            ? moveHandle(component, drag.handle!, target)
            : component,
        ),
      }));
      return;
    }
    if (drag.kind === "rotate" && drag.center) {
      const angle = Math.atan2(point.y - drag.center.y, point.x - drag.center.x);
      if (drag.lastAngle === undefined) {
        drag.lastAngle = angle;
        return;
      }
      const delta = angle - drag.lastAngle;
      drag.lastAngle = angle;
      if (Math.abs(delta) < 0.00001) {
        return;
      }
      if (!drag.tracked) {
        drag.tracked = true;
        beginCurveEdit();
      }
      updateCurvePreview((current) => ({
        components: current.components.map((component) =>
          component.id === drag.componentId
            ? rotateComponent(component, drag.center!, delta)
            : component,
        ),
      }));
      return;
    }
    const target = editPointFor(event) ?? point;
    if (!drag.last) {
      drag.last = target;
      return;
    }
    const delta = { x: target.x - drag.last.x, y: target.y - drag.last.y };
    drag.last = target;
    if (!drag.tracked) {
      drag.tracked = true;
      beginCurveEdit();
    }
    updateCurvePreview((current) => ({
      components: current.components.map((component) =>
        component.id === drag.componentId ? translateComponent(component, delta) : component,
      ),
    }));
  };

  /** Finish a pan, commit a single-gesture draft, or release the active drag. */
  const onCanvasPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pan = panDrag.current;
    if (pan) {
      panDrag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!pan.moved && pan.deselectOnClick) {
        clearSelection();
      }
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const current = draftRef.current;
    if (current && current.kind !== "polyline" && current.kind !== "curve") {
      finishDraft();
      return;
    }
    dragCanvas.current = null;
    setActiveHandle(null);
    setHoveredHandle(null);
  };

  /** Commit a polyline or curve draft on double-click. */
  const onCanvasDoubleClick = () => {
    if (finishesOnDoubleClick(draftRef.current)) {
      finishDraft();
    }
  };

  /** Clear hover and grid guides when the pointer leaves and no gesture is active. */
  const onCanvasPointerLeave = () => {
    if (dragCanvas.current || panDrag.current || draftRef.current) {
      return;
    }
    const hadGridHover = gridHover.current !== null;
    gridHover.current = null;
    setHover(null);
    setHoveredHandle(null);
    const element = canvas.current;
    if (element) {
      element.style.cursor = "default";
    }
    if (hadGridHover) {
      drawRef.current?.();
    }
  };

  /** Switch tools and discard any draft, connector, or hover from the old tool. */
  const changeTool = (next: CurveTool) => {
    setTool(next);
    dragCanvas.current = null;
    draftRef.current = null;
    setDraft(null);
    setConnectFirstId(null);
    setActiveHandle(null);
    setHoveredHandle(null);
    setHover(null);
    updateCurvePreview({ selectedSegment: null, status: t(TOOL_HINTS[next]) });
  };

  return (
    <div
      ref={layer}
      className="curve-preview-layer"
      role="region"
      aria-label={t("editorPanels.curvePreview.title")}
      data-components={activeComponents.length}
      data-draw-components={components.length}
      data-equation-components={draftState.equation.component ? "1" : "0"}
      data-selected={drawing ? (selectedId ?? "") : ""}
      data-selected-segment={
        drawing && selectedSegment
          ? `${selectedSegment.componentId}:${selectedSegment.segmentIndex}`
          : ""
      }
      data-tool={tool}
      data-mode={editMode}
      data-grid={gridEnabled ? String(gridSpacing) : ""}
      data-hover={
        hover ? `${hover.componentId}:${hover.segmentIndex === null ? "" : hover.segmentIndex}` : ""
      }
      data-zoom={camera.zoom.toFixed(2)}
      data-pan={`${Math.round(camera.panX)},${Math.round(camera.panY)}`}
      data-frame="true"
      data-selection-box={drawing && tool === "select" && selectedId ? "true" : "false"}
      data-preview-progress={previewProgress.toFixed(4)}
      data-connect-first={connectFirstId ?? ""}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <canvas
        ref={canvas}
        className="curve-preview-edit-canvas"
        role="region"
        aria-label={t("editorPanels.curvePreview.authoring.title")}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerCancel={onCanvasPointerUp}
        onPointerLeave={onCanvasPointerLeave}
        onDoubleClick={onCanvasDoubleClick}
      />
      <canvas ref={markerCanvas} className="curve-preview-marker-canvas" aria-hidden="true" />
      {drawing && (
        <CurveToolDock
          tool={tool}
          position={position}
          onToolChange={changeTool}
          onDragPointerDown={beginToolDockDrag}
          onReverse={reverseSelected}
        />
      )}
    </div>
  );
}
