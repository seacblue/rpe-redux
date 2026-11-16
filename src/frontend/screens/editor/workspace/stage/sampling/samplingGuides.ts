/**
 * Geometry and value mapping for the workspace sampler guides.
 *
 * The overlay paints stage-wide guide lines for XY samples, a horizontal
 * min-to-max scalar scale for rotation/opacity/speed, and the two draft
 * anchors on top of them. This module owns the chart-space to stage-space
 * conversion, the guide values derived from the live camera, and the one
 * pointer-to-sample rule.
 * The sampling session and the core sampler remain the only owners of state
 * and chart mutation.
 */
import {
  normalizeSamplingScalar,
  samplingGuideValues,
  samplingRangeOf,
  snapSamplingScalar,
  type SamplingAxis,
  type SamplingSettings,
  type SamplingValue,
} from "../../../../../../core/edit/sampling/sampling.ts";

/** Distance in CSS pixels under which a pointer snaps to a guide. */
export const SAMPLING_SNAP_PX = 6;

/** Guard against a pathologically dense guide list at extreme zoom-out. */
const MAX_GUIDE_LINES = 1200;
/** Minimum screen-space distance between generated guide lines. */
const MIN_GUIDE_SPACING_PX = 3;
/** Maximum size of one outside guide segment before its opacity is sampled. */
const GUIDE_SEGMENT_PX = 64;
/** Keep a dense chart from turning every guide into an excessive SVG tree. */
const MAX_GUIDE_SEGMENTS = 24;
/** Fraction of the preview dimension kept fully visible outside its frame. */
const GUIDE_BOUNDARY_FADE_START = 0.3;
/** Fraction of the preview short side used as the pointer reveal radius. */
const GUIDE_CURSOR_REVEAL_RATIO = 0.3;

/** Screen geometry of the preview the sampler reads for one frame. */
export interface SamplingProjection {
  stageWidth: number;
  stageHeight: number;
  canvasLeft: number;
  canvasTop: number;
  centerX: number;
  centerY: number;
  scaleX: number;
  scaleY: number;
  viewportLeft: number;
  viewportTop: number;
  viewportWidth: number;
  viewportHeight: number;
  lineX: number;
  lineY: number;
  lineRotation: number;
}

/** The preview viewport inside the stage, in stage pixels. */
export interface SamplingViewport {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

/** Stage-local pointer position used to reveal guides outside the preview. */
export interface SamplingGuideCursor {
  x: number;
  y: number;
}

/** One paintable portion of a guide line with its computed opacity. */
export interface SamplingGuideSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  opacity: number;
}

/** One full-viewport XY guide line. */
export interface SamplingGuideLine {
  key: string;
  /** Chart-space value the line marks. */
  value: number;
  /** Stage-space position: x for vertical lines, y for horizontal lines. */
  position: number;
  /** Every fifth guide gets a stronger stroke. */
  major: boolean;
}

/** The endpoint labels for a bounded scalar scale. */
export interface SamplingScalarScale {
  minValue: number;
  maxValue: number;
  minLabel: string;
  maxLabel: string;
}

/** Everything the guide layer needs to paint one frame. */
export interface SamplingGeometry {
  vertical: SamplingGuideLine[];
  horizontal: SamplingGuideLine[];
  scalar: SamplingScalarScale | null;
}

/** A pointer-derived sample, its rendered anchor, and its snap outcome. */
export interface SamplingPointerSample {
  value: SamplingValue;
  /** Stage position of the (possibly snapped) anchor. */
  stage: { x: number; y: number };
  /** True when the active coordinate landed on a guide. */
  snapped: boolean;
}

/** Clamp a scalar to the inclusive unit interval. */
function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Resolve the opacity of one guide point.
 *
 * Points inside the preview stay fully visible. Outside it, a guide remains
 * fully visible for 30% of the corresponding preview dimension, then fades to
 * zero over the next 30%. The pointer adds a transparent radial reveal around
 * the cursor so nearby off-frame values remain discoverable.
 */
export function samplingGuideOpacity(
  x: number,
  y: number,
  viewport: SamplingViewport,
  cursor: SamplingGuideCursor | null,
): number {
  const outsideX = Math.max(viewport.left - x, x - viewport.right, 0);
  const outsideY = Math.max(viewport.top - y, y - viewport.bottom, 0);
  if (outsideX <= 0 && outsideY <= 0) {
    return 1;
  }
  const outsideRatio = Math.max(
    outsideX / Math.max(1, viewport.width),
    outsideY / Math.max(1, viewport.height),
  );
  const boundaryOpacity = unit(
    (GUIDE_BOUNDARY_FADE_START * 2 - outsideRatio) / GUIDE_BOUNDARY_FADE_START,
  );
  if (!cursor) {
    return boundaryOpacity;
  }
  const cursorRadius =
    Math.max(1, Math.min(viewport.width, viewport.height)) * GUIDE_CURSOR_REVEAL_RATIO;
  const cursorOpacity = unit(1 - Math.hypot(cursor.x - x, cursor.y - y) / cursorRadius);
  return unit(boundaryOpacity + cursorOpacity);
}

/** Pixel distance at which a sampling guide starts responding to the pointer. */
export const SAMPLING_GUIDE_HOVER_DISTANCE = 15;

/** Return the nearest guide key when the pointer is close enough to one line. */
export function nearestGuideKey(
  lines: readonly SamplingGuideLine[],
  pointerPosition: number,
  maxDistance = SAMPLING_GUIDE_HOVER_DISTANCE,
): string | null {
  let nearest: SamplingGuideLine | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    const distance = Math.abs(line.position - pointerPosition);
    if (distance < nearestDistance) {
      nearest = line;
      nearestDistance = distance;
    }
  }
  return nearest && nearestDistance <= maxDistance ? nearest.key : null;
}

/** Resolve the hovered sampling guide while honoring the editor preference. */
export function samplingHoveredGuideKey(
  lines: readonly SamplingGuideLine[],
  pointerPosition: number,
  enabled: boolean,
  maxDistance = SAMPLING_GUIDE_HOVER_DISTANCE,
): string | null {
  return enabled ? nearestGuideKey(lines, pointerPosition, maxDistance) : null;
}

/**
 * Split a stage-wide guide into small paint segments.
 *
 * Sampling the opacity at each segment midpoint gives the outside fade a
 * smooth enough gradient without making every SVG frame depend on a CSS mask.
 */
export function samplingGuideSegments(
  position: number,
  direction: "vertical" | "horizontal",
  stageWidth: number,
  stageHeight: number,
  viewport: SamplingViewport,
  cursor: SamplingGuideCursor | null,
): SamplingGuideSegment[] {
  const length = direction === "vertical" ? stageHeight : stageWidth;
  const steps = Math.min(MAX_GUIDE_SEGMENTS, Math.max(1, Math.ceil(length / GUIDE_SEGMENT_PX)));
  const segments: SamplingGuideSegment[] = [];
  for (let index = 0; index < steps; index += 1) {
    const from = (length * index) / steps;
    const to = (length * (index + 1)) / steps;
    const middle = (from + to) / 2;
    const opacity =
      direction === "vertical"
        ? samplingGuideOpacity(position, middle, viewport, cursor)
        : samplingGuideOpacity(middle, position, viewport, cursor);
    segments.push(
      direction === "vertical"
        ? { x1: position, y1: from, x2: position, y2: to, opacity }
        : { x1: from, y1: position, x2: to, y2: position, opacity },
    );
  }
  return segments;
}

/** The viewport rectangle derived from a projection. */
export function viewportOf(projection: SamplingProjection): SamplingViewport {
  return {
    left: projection.viewportLeft,
    top: projection.viewportTop,
    width: projection.viewportWidth,
    height: projection.viewportHeight,
    right: projection.viewportLeft + projection.viewportWidth,
    bottom: projection.viewportTop + projection.viewportHeight,
  };
}

/** Convert stage pixels to chart-space coordinates. */
export function chartPointOf(
  stageX: number,
  stageY: number,
  projection: SamplingProjection,
): { x: number; y: number } {
  return {
    x: (stageX - projection.canvasLeft - projection.centerX) / Math.max(1e-6, projection.scaleX),
    y: -(stageY - projection.canvasTop - projection.centerY) / Math.max(1e-6, projection.scaleY),
  };
}

/** Convert chart-space coordinates to stage pixels. */
export function stagePointOf(
  x: number,
  y: number,
  projection: SamplingProjection,
): { x: number; y: number } {
  return {
    x: projection.canvasLeft + projection.centerX + x * projection.scaleX,
    y: projection.canvasTop + projection.centerY - y * projection.scaleY,
  };
}

/** Whether an axis uses the bounded scalar scale instead of XY guides. */
export function isScalarAxis(axis: SamplingAxis): boolean {
  return axis === "rotation" || axis === "alpha" || axis === "speed";
}

/** The base canvas domain used to map a scalar axis to the preview. */
function scalarBounds(axis: SamplingAxis): { min: number; max: number } {
  if (axis === "rotation") {
    return { min: -180, max: 180 };
  }
  const range = samplingRangeOf(axis);
  return { min: range.min, max: range.max };
}

/** Map one scalar to its stage x, continuing linearly outside the preview. */
export function scalarToStageX(
  axis: SamplingAxis,
  value: number,
  viewport: SamplingViewport,
): number {
  const { min, max } = scalarBounds(axis);
  const span = max - min;
  if (span === 0) {
    return viewport.left + viewport.width / 2;
  }
  const progress = (value - min) / span;
  return viewport.left + progress * viewport.width;
}

/** Map one stage x in the viewport to a raw scalar, including outside values. */
export function stageXToScalar(
  axis: SamplingAxis,
  stageX: number,
  viewport: SamplingViewport,
): number {
  const { min, max } = scalarBounds(axis);
  const progress = viewport.width > 0 ? (stageX - viewport.left) / viewport.width : 0.5;
  return min + progress * (max - min);
}

/** Scalar distance equivalent to the snap radius, in the active axis' units. */
export function scalarTolerance(axis: SamplingAxis, viewport: SamplingViewport): number {
  if (viewport.width <= 0) {
    return 0;
  }
  const { min, max } = scalarBounds(axis);
  return (SAMPLING_SNAP_PX / viewport.width) * Math.abs(max - min);
}

/** Return pointer settings with guide snapping disabled for a hidden-grid modifier. */
export function samplingSettingsForPointer(
  settings: SamplingSettings,
  guidesHidden: boolean,
): SamplingSettings {
  return guidesHidden ? { ...settings, guidesEnabled: false } : settings;
}

/** Chart-space distance equivalent to the snap radius on one XY axis. */
export function xyTolerance(axis: "x" | "y", projection: SamplingProjection): number {
  const scale = Math.abs(axis === "x" ? projection.scaleX : projection.scaleY);
  return SAMPLING_SNAP_PX / Math.max(1e-6, scale);
}

/** Compact, unit-aware text for one scalar value. */
export function formatSamplingScalar(axis: SamplingAxis, value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (axis === "rotation") {
    return `${Number(rounded.toFixed(1))}°`;
  }
  if (axis === "alpha") {
    return String(Math.round(value));
  }
  if (axis === "speed") {
    return `${Number(rounded.toFixed(2))}×`;
  }
  return String(rounded);
}

/** Build the guide set for the current projection and sampling axis. */
export function buildSamplingGeometry(
  projection: SamplingProjection,
  axis: SamplingAxis,
  settings: SamplingSettings,
): SamplingGeometry {
  const viewport = viewportOf(projection);
  if (!isScalarAxis(axis)) {
    return {
      vertical: buildXYGuides(projection, viewport, settings, "x"),
      horizontal: buildXYGuides(projection, viewport, settings, "y"),
      scalar: null,
    };
  }
  return {
    vertical: buildScalarGuides(axis, projection, viewport, settings),
    horizontal: [],
    scalar: buildScalarScale(axis),
  };
}

/** Build vertical or horizontal XY guide lines across the current viewport. */
function buildXYGuides(
  projection: SamplingProjection,
  viewport: SamplingViewport,
  settings: SamplingSettings,
  direction: "x" | "y",
): SamplingGuideLine[] {
  const step = Math.max(0.01, settings.guideStep);
  const lines: SamplingGuideLine[] = [];
  const start = 0;
  const end = direction === "x" ? projection.stageWidth : projection.stageHeight;
  const chartStart =
    direction === "x"
      ? chartPointOf(start, viewport.top, projection).x
      : chartPointOf(viewport.left, start, projection).y;
  const chartEnd =
    direction === "x"
      ? chartPointOf(end, viewport.bottom, projection).x
      : chartPointOf(viewport.right, end, projection).y;
  const minimum = Math.min(chartStart, chartEnd);
  const maximum = Math.max(chartStart, chartEnd);
  const firstIndex = Math.ceil(minimum / step);
  const lastIndex = Math.floor(maximum / step);
  const count = lastIndex - firstIndex + 1;
  if (count <= 0) {
    return lines;
  }
  const screenStep = Math.abs((direction === "x" ? projection.scaleX : projection.scaleY) * step);
  const pixelStride = Math.max(
    1,
    Math.ceil(MIN_GUIDE_SPACING_PX / Math.max(Number.EPSILON, screenStep)),
  );
  const countStride = Math.max(1, Math.ceil(count / MAX_GUIDE_LINES));
  const stride = Math.max(pixelStride, countStride);
  for (let index = firstIndex; index <= lastIndex; index += stride) {
    const value = index * step;
    const position =
      direction === "x"
        ? stagePointOf(value, 0, projection).x
        : stagePointOf(0, value, projection).y;
    lines.push({
      key: `${direction}:${index}`,
      value,
      position,
      major: index % 5 === 0,
    });
  }
  return lines;
}

/** Build scalar guide lines across the entire stage, including outside the preview. */
function buildScalarGuides(
  axis: SamplingAxis,
  projection: SamplingProjection,
  viewport: SamplingViewport,
  settings: SamplingSettings,
): SamplingGuideLine[] {
  const { min, max } = scalarBounds(axis);
  const span = max - min;
  const configuredValues = samplingGuideValues(axis, settings);
  const firstPositive = configuredValues.find((value) => value > min);
  const step = Math.max(Number.EPSILON, (firstPositive ?? max) - min);
  const pixelsPerUnit = viewport.width / Math.max(Number.EPSILON, span);
  const pixelStep = Math.max(Number.EPSILON, step * pixelsPerUnit);
  const firstIndex = Math.floor(-viewport.left / pixelStep);
  const lastIndex = Math.ceil((projection.stageWidth - viewport.left) / pixelStep);
  const count = Math.max(0, lastIndex - firstIndex + 1);
  const stride = Math.max(1, Math.ceil(count / MAX_GUIDE_LINES));
  const lines = new Map<number, SamplingGuideLine>();

  for (let index = firstIndex; index <= lastIndex; index += stride) {
    const value = min + index * step;
    lines.set(value, {
      key: `${axis}:${value}`,
      value,
      position: scalarGuideStageX(axis, value, viewport),
      major: index % 5 === 0,
    });
  }

  // Keep the configured endpoints visible even when the bounded maximum is not
  // an exact multiple of the guide step (for example alpha=255 at step 20).
  for (const value of [min, ...configuredValues, max]) {
    lines.set(value, {
      key: `${axis}:${value}`,
      value,
      position: scalarGuideStageX(axis, value, viewport),
      major: value === min || value === max,
    });
  }

  return [...lines.values()].sort((left, right) => left.position - right.position);
}

/** Map a scalar to stage x without clamping, for the infinite scalar grid. */
function scalarGuideStageX(axis: SamplingAxis, value: number, viewport: SamplingViewport): number {
  const { min, max } = scalarBounds(axis);
  const span = max - min;
  return viewport.left + ((value - min) / span) * viewport.width;
}

/** Build only the endpoint labels for a bounded scalar axis. */
function buildScalarScale(axis: SamplingAxis): SamplingScalarScale {
  const { min, max } = scalarBounds(axis);
  return {
    minValue: min,
    maxValue: max,
    minLabel: formatSamplingScalar(axis, min),
    maxLabel: formatSamplingScalar(axis, max),
  };
}

/** Snap one XY coordinate to the viewport guide grid when it is close enough. */
function snapXY(
  axis: "x" | "y",
  raw: number,
  settings: SamplingSettings,
  tolerance: number,
): { value: number; snapped: boolean } {
  const step = Math.max(0.01, settings.guideStep);
  const nearest = Math.round(raw / step) * step;
  const close = settings.guidesEnabled && Math.abs(raw - nearest) <= tolerance;
  // The core sampler owns normalization; the overlay supplies the viewport
  // guide because the chart grid is camera-dependent.
  const result = snapSamplingScalar(axis, close ? nearest : raw, settings, tolerance);
  return { value: result.value, snapped: close };
}

/** Snap an XY pointer only when it is close to a full guide intersection. */
function snapXYPoint(
  raw: { x: number; y: number },
  settings: SamplingSettings,
  projection: SamplingProjection,
): { point: { x: number; y: number }; snapped: boolean } {
  const x = snapXY("x", raw.x, settings, xyTolerance("x", projection));
  const y = snapXY("y", raw.y, settings, xyTolerance("y", projection));
  if (x.snapped && y.snapped) {
    return { point: { x: x.value, y: y.value }, snapped: true };
  }
  return {
    point: {
      x: normalizeSamplingScalar("x", raw.x),
      y: normalizeSamplingScalar("y", raw.y),
    },
    snapped: false,
  };
}

/** Convert a client pointer to the sample for the active axis. */
export function sampleSamplingPointer(
  clientX: number,
  clientY: number,
  bounds: DOMRect,
  projection: SamplingProjection,
  axis: SamplingAxis,
  settings: SamplingSettings,
): SamplingPointerSample {
  const viewport = viewportOf(projection);
  const stageX = clientX - bounds.left;
  const stageY = clientY - bounds.top;
  if (isScalarAxis(axis)) {
    const raw = stageXToScalar(axis, stageX, viewport);
    const result = snapSamplingScalar(axis, raw, settings, scalarTolerance(axis, viewport));
    const x = scalarToStageX(axis, result.value, viewport);
    const point = chartPointOf(stageX, stageY, projection);
    return {
      value: { axis, scalar: result.value, point },
      stage: { x, y: stageY },
      snapped: result.snapped,
    };
  }

  const raw = chartPointOf(stageX, stageY, projection);
  const snapped = snapXYPoint(raw, settings, projection);
  return {
    value: {
      axis,
      scalar: axis === "x" ? snapped.point.x : snapped.point.y,
      point: snapped.point,
    },
    stage: stagePointOf(snapped.point.x, snapped.point.y, projection),
    snapped: snapped.snapped,
  };
}

/** The rendered stage position of one draft anchor. */
export function anchorStagePoint(
  value: SamplingValue,
  projection: SamplingProjection,
): { x: number; y: number } {
  if (value.axis === "x") {
    return stagePointOf(value.scalar, value.point?.y ?? 0, projection);
  }
  if (value.axis === "y") {
    return stagePointOf(value.point?.x ?? 0, value.scalar, projection);
  }
  const viewport = viewportOf(projection);
  const y =
    value.point && Number.isFinite(value.point.y)
      ? stagePointOf(0, value.point.y, projection).y
      : projection.lineY;
  return {
    x: scalarToStageX(value.axis, value.scalar, viewport),
    y: Number.isFinite(y) ? y : viewport.top + viewport.height / 2,
  };
}
