/**
 * Transparent curve drawing and hit geometry for the preview overlay.
 *
 * The chart preview remains the background; this module only paints editable
 * paths and their Bezier nodes/handles on a separate canvas above it.
 */
import {
  componentEndpoints,
  type CurvePathComponent,
  type CurvePathPoint,
  type SegmentTarget,
} from "./pathModel.ts";
import { componentVisualBounds } from "./pathBounds.ts";
import { prepareCanvas } from "../canvas/canvas2d.ts";
import { previewViewport } from "../workspace/preview/scene/viewport.ts";
import {
  previewCameraFrame,
  type PreviewCamera,
} from "../workspace/preview/scene/previewCamera.ts";
import { readCanvasPalette } from "../canvas/palette.ts";

/** Screen distance between a selected path's top edge and its rotation handle. */
const ROTATION_HANDLE_GAP = 28;

export interface OverlayRotation {
  /** The pivot, in chart coordinates. */
  center: CurvePathPoint;
  /** The grabbable handle, in chart coordinates. */
  handle: CurvePathPoint;
}

interface CurveColors {
  foreground: string;
  outline: string;
  surface: string;
  accent: string;
  marker: string;
  playhead: string;
  draft: string;
  grid: string;
  gridOrigin: string;
  highlight: string;
}

/**
 * Read the theme's canvas palette for every visible curve mark.
 *
 * Handles, paths, grid lines, and the hover guide all use semantic tokens so
 * they stay legible on both light and dark themes.
 */
function curveColors(): CurveColors {
  const palette = readCanvasPalette();
  return {
    foreground: palette.foreground,
    outline: palette.outline,
    surface: palette.surface,
    accent: palette.previewLineSelected,
    marker: palette.inspectorMarker,
    playhead: palette.playhead,
    draft: palette.previewLine,
    grid: palette.gridMinor,
    gridOrigin: palette.gridMajor,
    highlight: palette.bottomValue,
  };
}

/** The whole-path rotation pivot and handle for a selected component. */
export function rotationGeometry(
  component: CurvePathComponent,
  view: OverlayView,
): OverlayRotation | null {
  const bounds = componentVisualBounds(component);
  if (!bounds) {
    return null;
  }
  const center = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
  const scaleY = view.scaleY ?? view.scale;
  return {
    center,
    // Chart Y grows upward, so above the shape is a larger Y.
    handle: { x: center.x, y: bounds.top + ROTATION_HANDLE_GAP / Math.max(0.01, scaleY) },
  };
}

export interface OverlayView {
  width: number;
  height: number;
  scale: number;
  /** Optional independent axes used by the chart's presentation viewport. */
  scaleX?: number;
  scaleY?: number;
  centerX: number;
  centerY: number;
}

/**
 * Match the chart preview's aspect ratio, view divisor, and free-camera view,
 * independently of edit navigation.
 */
export function previewOverlayView(
  canvas: HTMLCanvasElement,
  aspectRatio?: number,
  divisor = 1,
  camera?: PreviewCamera,
): OverlayView {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const viewport = previewViewport(width, height, aspectRatio);
  const frame = previewCameraFrame(viewport, camera, divisor);
  return {
    width,
    height,
    scale: frame.scale,
    scaleX: frame.scaleX,
    scaleY: frame.scaleY,
    centerX: frame.centerX,
    centerY: frame.centerY,
  };
}

export type OverlayPointField = "p0" | "p1" | "p2" | "p3";

/** The chart's logical drawing area: X from -675 to 675, Y from -450 to 450. */
export const CURVE_STAGE_WIDTH = 1350;
export const CURVE_STAGE_HEIGHT = 900;

export interface OverlayDraft {
  kind: "pencil" | "line" | "polyline" | "curve";
  points: readonly CurvePathPoint[];
}

export interface OverlayHandle {
  segmentIndex: number;
  field: OverlayPointField;
  kind: "node" | "control";
  point: CurvePathPoint;
}

/** Convert a chart point to screen pixels for the given view. */
export function overlayToScreen(view: OverlayView, point: CurvePathPoint): CurvePathPoint {
  // Chart Y points up; the canvas Y points down. The draft and the preview line
  // share chart coordinates, so the mapping keeps the chart's sign convention.
  return {
    x: view.centerX + point.x * (view.scaleX ?? view.scale),
    y: view.centerY - point.y * (view.scaleY ?? view.scale),
  };
}

/** Convert a screen-pixel point back to chart coordinates for the given view. */
export function overlayToWorld(view: OverlayView, point: CurvePathPoint): CurvePathPoint {
  return {
    x: (point.x - view.centerX) / (view.scaleX ?? view.scale),
    y: (view.centerY - point.y) / (view.scaleY ?? view.scale),
  };
}

/** Size the backing store for the device pixel ratio and clear the canvas. */
function prepare(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  if (!canvas.getContext("2d")) {
    return null;
  }
  return prepareCanvas(canvas, true, {
    width: Math.max(1, canvas.clientWidth),
    height: Math.max(1, canvas.clientHeight),
  }).context;
}

/** Colours at the start and end of a path's direction gradient. */
const START_COLOR = [94, 231, 160] as const;
const END_COLOR = [248, 113, 113] as const;

/** Blend the path gradient at a normalized position. */
function pathColor(progress: number): string {
  const amount = Math.max(0, Math.min(1, progress));
  const channel = (index: 0 | 1 | 2) =>
    Math.round(START_COLOR[index] + (END_COLOR[index] - START_COLOR[index]) * amount);
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`;
}

/** Add a component's screen-space Bezier chain to the current context path. */
function traceComponent(
  context: CanvasRenderingContext2D,
  view: OverlayView,
  component: CurvePathComponent,
): void {
  const first = overlayToScreen(view, component.segments[0].p0);
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const segment of component.segments) {
    const p1 = overlayToScreen(view, segment.p1);
    const p2 = overlayToScreen(view, segment.p2);
    const p3 = overlayToScreen(view, segment.p3);
    context.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  }
}

/** Paint one component's stroke, halo, selected segment, and endpoint dots. */
function drawComponent(
  context: CanvasRenderingContext2D,
  view: OverlayView,
  component: CurvePathComponent,
  options: {
    selected: boolean;
    hovered: boolean;
    hoveredSegment: number | null;
    selectedSegment: SegmentTarget | null;
    dimmed: boolean;
    connectFirst: boolean;
    colors: CurveColors;
  },
): void {
  if (!component.segments.length) {
    return;
  }
  const { selected, hovered, hoveredSegment, selectedSegment, dimmed, connectFirst, colors } =
    options;
  const count = Math.max(1, component.segments.length);
  const selectedIndex =
    selectedSegment?.componentId === component.id ? selectedSegment.segmentIndex : -1;
  const baseAlpha = dimmed ? 0.5 : 1;
  context.save();
  context.globalAlpha = baseAlpha;
  if (selected || hovered) {
    // A soft halo separates the active path from the chart behind it without
    // changing the path's directional gradient.
    for (const segment of component.segments) {
      const p0 = overlayToScreen(view, segment.p0);
      const p1 = overlayToScreen(view, segment.p1);
      const p2 = overlayToScreen(view, segment.p2);
      const p3 = overlayToScreen(view, segment.p3);
      context.beginPath();
      context.moveTo(p0.x, p0.y);
      context.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      context.strokeStyle = colors.accent;
      context.globalAlpha = baseAlpha * (selected ? 0.2 : 0.12);
      context.lineWidth = selected ? 9 : 7;
      context.stroke();
      context.globalAlpha = baseAlpha;
    }
  }
  for (const [index, segment] of component.segments.entries()) {
    const p0 = overlayToScreen(view, segment.p0);
    const p1 = overlayToScreen(view, segment.p1);
    const p2 = overlayToScreen(view, segment.p2);
    const p3 = overlayToScreen(view, segment.p3);
    const gradient = context.createLinearGradient(p0.x, p0.y, p3.x, p3.y);
    gradient.addColorStop(0, pathColor(index / count));
    gradient.addColorStop(1, pathColor((index + 1) / count));
    context.beginPath();
    context.moveTo(p0.x, p0.y);
    context.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    context.strokeStyle = gradient;
    context.lineWidth = selected ? 3.5 : hovered ? 3 : 2.5;
    context.shadowColor = pathColor((index + 0.5) / count);
    context.shadowBlur = selected ? 12 : hovered ? 9 : 5;
    context.stroke();
    if (index === hoveredSegment && index !== selectedIndex) {
      context.beginPath();
      context.moveTo(p0.x, p0.y);
      context.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      context.strokeStyle = colors.accent;
      context.lineWidth = 4;
      context.shadowColor = colors.accent;
      context.shadowBlur = 10;
      context.globalAlpha = baseAlpha * 0.65;
      context.stroke();
      context.globalAlpha = baseAlpha;
    }
    if (index === selectedIndex) {
      context.beginPath();
      context.moveTo(p0.x, p0.y);
      context.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      context.strokeStyle = colors.accent;
      context.lineWidth = 5;
      context.shadowColor = colors.accent;
      context.shadowBlur = 16;
      context.stroke();
    }
  }
  context.shadowBlur = 0;

  if (connectFirst) {
    traceComponent(context, view, component);
    context.save();
    context.setLineDash([5, 4]);
    context.strokeStyle = colors.foreground;
    context.globalAlpha = 0.9;
    context.lineWidth = 1.5;
    context.stroke();
    context.restore();
    const tail = component.segments.at(-1)?.p3;
    if (tail) {
      const screen = overlayToScreen(view, tail);
      context.beginPath();
      context.arc(screen.x, screen.y, 8, 0, Math.PI * 2);
      context.strokeStyle = colors.foreground;
      context.globalAlpha = 0.85;
      context.lineWidth = 1.5;
      context.stroke();
      context.globalAlpha = 1;
    }
  }

  if (selected) {
    const endpoints = componentEndpoints(component);
    if (endpoints) {
      for (const [index, endpoint] of endpoints.entries()) {
        const screen = overlayToScreen(view, endpoint);
        context.beginPath();
        context.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
        context.fillStyle = index === 0 ? pathColor(0) : pathColor(1);
        context.fill();
        context.strokeStyle = colors.outline;
        context.lineWidth = 2;
        context.stroke();
      }
    }
  }
  context.restore();
}

/** Draw one node marker, enlarged and ringed when active or hovered. */
function drawNode(
  context: CanvasRenderingContext2D,
  screen: CurvePathPoint,
  active: boolean,
  hovered: boolean,
  colors: CurveColors,
): void {
  const size = active ? 9 : hovered ? 8 : 7;
  const half = size / 2;
  context.beginPath();
  context.rect(screen.x - half, screen.y - half, size, size);
  context.fillStyle = active ? colors.accent : colors.foreground;
  context.fill();
  context.strokeStyle = colors.outline;
  context.lineWidth = 1.5;
  context.stroke();
  if (active || hovered) {
    context.beginPath();
    context.arc(screen.x, screen.y, half + 4, 0, Math.PI * 2);
    context.strokeStyle = colors.accent;
    context.lineWidth = 1.5;
    context.stroke();
  }
}

/** Draw one control-handle dot, filled when active or hovered. */
function drawControl(
  context: CanvasRenderingContext2D,
  screen: CurvePathPoint,
  active: boolean,
  hovered: boolean,
  colors: CurveColors,
): void {
  const radius = active ? 5.5 : hovered ? 5 : 4;
  context.beginPath();
  context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  context.fillStyle = active || hovered ? colors.accent : colors.surface;
  context.fill();
  context.strokeStyle = active || hovered ? colors.outline : colors.foreground;
  context.lineWidth = active || hovered ? 2 : 1.5;
  context.stroke();
  if (active || hovered) {
    context.beginPath();
    context.arc(screen.x, screen.y, radius + 3.5, 0, Math.PI * 2);
    context.strokeStyle = colors.accent;
    context.lineWidth = 1.5;
    context.stroke();
  }
}

/** Draw every node, control handle, tangent line, and the rotation grip. */
function drawHandles(
  context: CanvasRenderingContext2D,
  view: OverlayView,
  component: CurvePathComponent,
  active: OverlayHandle | null,
  hovered: OverlayHandle | null,
  colors: CurveColors,
): void {
  /** Match a handle by segment and field. */
  const isSame = (candidate: OverlayHandle | null, segmentIndex: number, field: string) =>
    candidate?.segmentIndex === segmentIndex && candidate.field === field;
  /** Whether two points coincide within float tolerance. */
  const samePoint = (left: CurvePathPoint | undefined, right: CurvePathPoint) =>
    Boolean(left && Math.hypot(left.x - right.x, left.y - right.y) < 1e-6);
  for (const [segmentIndex, segment] of component.segments.entries()) {
    for (const field of ["p1", "p2"] as const) {
      const point = segment[field];
      const screen = overlayToScreen(view, point);
      const anchor = overlayToScreen(view, field === "p1" ? segment.p0 : segment.p3);
      const isActive = isSame(active, segmentIndex, field);
      const isHovered = isSame(hovered, segmentIndex, field);
      context.beginPath();
      context.moveTo(anchor.x, anchor.y);
      context.lineTo(screen.x, screen.y);
      context.strokeStyle = colors.foreground;
      context.globalAlpha = isActive || isHovered ? 0.85 : 0.38;
      context.lineWidth = isActive || isHovered ? 1.5 : 1;
      context.stroke();
      context.globalAlpha = 1;
      drawControl(context, screen, isActive, isHovered, colors);
    }
    for (const field of ["p0", "p3"] as const) {
      const point = segment[field];
      const screen = overlayToScreen(view, point);
      // A shared node between two segments is drawn twice; both copies must
      // inherit the active/hover state or the later one erases the highlight.
      const activeHere =
        isSame(active, segmentIndex, field) ||
        (active?.kind === "node" && samePoint(active.point, point));
      const hoveredHere =
        isSame(hovered, segmentIndex, field) ||
        (hovered?.kind === "node" && samePoint(hovered.point, point));
      drawNode(context, screen, activeHere, hoveredHere, colors);
    }
  }
  const rotation = rotationGeometry(component, view);
  const bounds = componentVisualBounds(component);
  if (rotation && bounds) {
    const top = overlayToScreen(view, { x: rotation.center.x, y: bounds.top });
    const handle = overlayToScreen(view, rotation.handle);
    context.beginPath();
    context.moveTo(top.x, top.y);
    context.lineTo(handle.x, handle.y);
    context.strokeStyle = colors.marker;
    context.globalAlpha = 0.7;
    context.lineWidth = 1;
    context.stroke();
    context.globalAlpha = 1;
    context.beginPath();
    context.arc(handle.x, handle.y, 6, 0, Math.PI * 2);
    context.fillStyle = colors.marker;
    context.fill();
    context.strokeStyle = colors.outline;
    context.lineWidth = 1.5;
    context.stroke();
    // A small open arc and arrowhead read as "rotate" even without a label.
    context.beginPath();
    context.strokeStyle = colors.outline;
    context.lineWidth = 1.2;
    context.arc(handle.x, handle.y, 3.2, Math.PI * 0.15, Math.PI * 1.55);
    context.stroke();
    context.beginPath();
    context.moveTo(handle.x + 2.2, handle.y - 3.1);
    context.lineTo(handle.x + 4.1, handle.y - 1.4);
    context.lineTo(handle.x + 1.6, handle.y - 0.9);
    context.closePath();
    context.fillStyle = colors.outline;
    context.fill();
  }
}

/**
 * Draw the editing grid clipped to the 1350×900 chart area.
 *
 * `distance` is the gap between grid lines in chart units, so spacing follows
 * zoom. Lines through the origin are brighter; `hover` lifts the nearest pair.
 */
export function drawCurveGrid(
  context: CanvasRenderingContext2D,
  view: OverlayView,
  distance: number,
  colors?: Pick<CurveColors, "grid" | "gridOrigin" | "highlight">,
  hover?: CurvePathPoint | null,
): void {
  const spacing = curveGridSpacing(distance);
  const scaleX = view.scaleX ?? view.scale;
  const scaleY = view.scaleY ?? view.scale;
  const left = -view.centerX / scaleX;
  const right = (view.width - view.centerX) / scaleX;
  // Chart Y points up, so the screen bottom is the lowest chart Y.
  const minY = (view.centerY - view.height) / scaleY;
  const maxY = view.centerY / scaleY;
  const frameLeft = view.centerX - (CURVE_STAGE_WIDTH / 2) * scaleX;
  const frameTop = view.centerY - (CURVE_STAGE_HEIGHT / 2) * scaleY;
  context.save();
  // The grid belongs to the 1350×900 chart area; the margin outside the frame
  // stays empty so the boundary is the edge of the canvas, not a line floating
  // in more grid.
  context.beginPath();
  context.rect(frameLeft, frameTop, CURVE_STAGE_WIDTH * scaleX, CURVE_STAGE_HEIGHT * scaleY);
  context.clip();
  context.lineWidth = 1;
  const gridColor = colors?.grid ?? "rgba(130, 170, 210, 0.14)";
  const originColor = colors?.gridOrigin ?? "rgba(232, 205, 121, 0.42)";
  for (let index = Math.ceil(left / spacing); index <= Math.floor(right / spacing); index++) {
    const x = overlayToScreen(view, { x: index * spacing, y: 0 }).x;
    context.strokeStyle = index === 0 ? originColor : gridColor;
    context.beginPath();
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, view.height);
    context.stroke();
  }
  for (let index = Math.ceil(minY / spacing); index <= Math.floor(maxY / spacing); index++) {
    const y = overlayToScreen(view, { x: 0, y: index * spacing }).y;
    context.strokeStyle = index === 0 ? originColor : gridColor;
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(view.width, y + 0.5);
    context.stroke();
  }
  if (hover) {
    const nearestX = Math.round(hover.x / spacing) * spacing;
    const nearestY = Math.round(hover.y / spacing) * spacing;
    const x = overlayToScreen(view, { x: nearestX, y: 0 }).x;
    const y = overlayToScreen(view, { x: 0, y: nearestY }).y;
    context.strokeStyle = colors?.highlight ?? "rgba(125, 183, 255, 0.9)";
    context.globalAlpha = 0.72;
    context.globalCompositeOperation = "screen";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(x + 0.5, frameTop);
    context.lineTo(x + 0.5, frameTop + CURVE_STAGE_HEIGHT * scaleY);
    context.moveTo(frameLeft, y + 0.5);
    context.lineTo(frameLeft + CURVE_STAGE_WIDTH * scaleX, y + 0.5);
    context.stroke();
  }
  context.restore();
}

/** Clamp a grid distance to the authoring range. */
export function curveGridSpacing(value: number): number {
  const spacing = Number(value);
  return Math.max(10, Math.min(200, Number.isFinite(spacing) && spacing > 0 ? spacing : 50));
}

/** Snap a chart point to the nearest grid intersection. */
export function snapToCurveGrid(point: CurvePathPoint, distance: number): CurvePathPoint {
  const spacing = curveGridSpacing(distance);
  return {
    x: Math.round(point.x / spacing) * spacing,
    y: Math.round(point.y / spacing) * spacing,
  };
}

/**
 * Return the authoring point for a pointer position.
 *
 * A visible grid is the only snapping switch: creation and handle drags always
 * use intersections while the grid is shown.
 */
export function curveEditPoint(
  point: CurvePathPoint,
  gridEnabled: boolean,
  distance: number,
): CurvePathPoint {
  return gridEnabled ? snapToCurveGrid(point, distance) : point;
}

/** The playhead marker a previewed trajectory drives along the path. */
export function drawPreviewMarker(
  context: CanvasRenderingContext2D,
  view: OverlayView,
  position: CurvePathPoint,
  colors?: Pick<CurveColors, "playhead" | "outline">,
): void {
  const screen = overlayToScreen(view, position);
  const marker = colors?.playhead ?? "rgba(255, 82, 82, 0.9)";
  context.save();
  context.strokeStyle = marker;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(screen.x - 18, screen.y);
  context.lineTo(screen.x + 18, screen.y);
  context.stroke();
  context.beginPath();
  context.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
  context.fillStyle = marker;
  context.shadowColor = marker;
  context.shadowBlur = 10;
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = colors?.outline ?? "#10131a";
  context.lineWidth = 1.5;
  context.stroke();
  context.restore();
}

/** Repaint one dedicated marker canvas, clearing it when the marker is absent. */
export function drawCurvePreviewMarker(
  canvas: HTMLCanvasElement,
  options: {
    view: OverlayView;
    position: CurvePathPoint | null;
    colors?: Pick<CurveColors, "playhead" | "outline">;
  },
): void {
  const context = prepare(canvas);
  if (!context || !options.position) {
    return;
  }
  drawPreviewMarker(context, options.view, options.position, options.colors);
}

/**
 * The selected path's bounding rectangle.
 *
 * The border is the only translation grip, so it is drawn as a clear frame with
 * corner ticks. The interior stays free for segment picking and canvas panning.
 */
export function drawSelectionFrame(
  context: CanvasRenderingContext2D,
  view: OverlayView,
  component: CurvePathComponent,
  colors?: Pick<CurveColors, "accent" | "outline">,
): void {
  const bounds = componentVisualBounds(component);
  if (!bounds) {
    return;
  }
  const topLeft = overlayToScreen(view, { x: bounds.left, y: bounds.top });
  const bottomRight = overlayToScreen(view, { x: bounds.right, y: bounds.bottom });
  const padding = 6;
  const left = Math.min(topLeft.x, bottomRight.x) - padding;
  const top = Math.min(topLeft.y, bottomRight.y) - padding;
  const width = Math.abs(bottomRight.x - topLeft.x) + padding * 2;
  const height = Math.abs(bottomRight.y - topLeft.y) + padding * 2;
  const accent = colors?.accent ?? "rgba(232, 205, 121, 0.92)";
  const outline = colors?.outline ?? "rgba(12, 18, 26, 0.55)";
  context.save();
  context.setLineDash([5, 4]);
  context.strokeStyle = accent;
  context.lineWidth = 1.5;
  context.strokeRect(left + 0.5, top + 0.5, width, height);
  context.setLineDash([]);
  // Corner ticks make the frame read as a grip rather than a marquee.
  const tick = 8;
  context.strokeStyle = accent;
  context.lineWidth = 2;
  for (const [x, y, dx, dy] of [
    [left, top, 1, 1],
    [left + width, top, -1, 1],
    [left, top + height, 1, -1],
    [left + width, top + height, -1, -1],
  ] as const) {
    context.beginPath();
    context.moveTo(x, y + dy * tick);
    context.lineTo(x, y);
    context.lineTo(x + dx * tick, y);
    context.stroke();
  }
  context.strokeStyle = outline;
  context.globalAlpha = 0.4;
  context.lineWidth = 1;
  context.strokeRect(left + 0.5, top + 0.5, width, height);
  context.restore();
}

/** Draw the in-progress freehand or shape stroke. */
function drawDraft(
  context: CanvasRenderingContext2D,
  view: OverlayView,
  draft: OverlayDraft,
  colors: Pick<CurveColors, "draft">,
): void {
  if (!draft.points.length) {
    return;
  }
  context.save();
  context.beginPath();
  const first = overlayToScreen(view, draft.points[0]);
  context.moveTo(first.x, first.y);
  for (const point of draft.points.slice(1)) {
    const screen = overlayToScreen(view, point);
    context.lineTo(screen.x, screen.y);
  }
  context.strokeStyle = colors.draft;
  context.lineWidth = 2.5;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();
  context.restore();
}

/** Repaint the whole overlay: grid, paths, handles, frame, draft, and marker. */
export function drawCurveOverlay(
  canvas: HTMLCanvasElement,
  options: {
    components: readonly CurvePathComponent[];
    selectedId: string | null;
    selectedSegment?: SegmentTarget | null;
    activeHandle: OverlayHandle | null;
    hoveredHandle?: OverlayHandle | null;
    hover?: { componentId: string; segmentIndex: number | null } | null;
    connectFirstId?: string | null;
    draft?: OverlayDraft | null;
    gridDistance?: number | null;
    /** Pointer position in chart coordinates; highlights the nearest grid lines. */
    gridHover?: CurvePathPoint | null;
    previewPoint?: CurvePathPoint | null;
    showHandles?: boolean;
    /** Draw the selected path's bounding rectangle (select mode). */
    selectionFrame?: boolean;
    /** The renderer's viewport; edit and preview share this mapping. */
    view: OverlayView;
  },
): void {
  const context = prepare(canvas);
  if (!context) {
    return;
  }
  const colors = curveColors();
  const view = options.view;
  if (options.gridDistance) {
    drawCurveGrid(context, view, options.gridDistance, colors, options.gridHover ?? null);
  }
  const ordered = [...options.components].sort((left, right) => {
    const leftSelected = left.id === options.selectedId ? 1 : 0;
    const rightSelected = right.id === options.selectedId ? 1 : 0;
    return leftSelected - rightSelected;
  });
  for (const component of ordered) {
    drawComponent(context, view, component, {
      selected: component.id === options.selectedId,
      hovered: component.id === options.hover?.componentId,
      hoveredSegment:
        component.id === options.hover?.componentId ? (options.hover?.segmentIndex ?? null) : null,
      selectedSegment: options.selectedSegment ?? null,
      dimmed: Boolean(options.selectedId) && component.id !== options.selectedId,
      connectFirst: component.id === options.connectFirstId,
      colors,
    });
  }
  const selected = options.components.find((component) => component.id === options.selectedId);
  if (selected && options.showHandles) {
    drawHandles(
      context,
      view,
      selected,
      options.activeHandle,
      options.hoveredHandle ?? null,
      colors,
    );
  }
  if (selected && options.selectionFrame) {
    drawSelectionFrame(context, view, selected, colors);
  }
  if (options.draft) {
    drawDraft(context, view, options.draft, colors);
  }
  if (options.previewPoint) {
    drawPreviewMarker(context, view, options.previewPoint, colors);
  }
}

/** Move a node and its adjacent segment endpoint together, or move one handle. */
export function moveHandle(
  component: CurvePathComponent,
  handle: OverlayHandle,
  point: CurvePathPoint,
): CurvePathComponent {
  const segments = component.segments.map((segment, index) => {
    let next = segment;
    if (index === handle.segmentIndex) {
      next = { ...next, [handle.field]: point };
    }
    if (handle.field === "p3" && index === handle.segmentIndex + 1) {
      next = { ...next, p0: point };
    }
    if (handle.field === "p0" && index === handle.segmentIndex - 1) {
      next = { ...next, p3: point };
    }
    return next;
  });
  return { ...component, segments };
}
