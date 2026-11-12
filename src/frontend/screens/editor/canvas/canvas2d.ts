/** Shared Canvas 2D preparation for preview, timeline, and inspector surfaces. */
import { t } from "../../../../i18n/index.ts";

/** Highest device-pixel ratio used for a canvas backing store. */
export const MAX_CANVAS_PIXEL_RATIO = 2;

/**
 * Device-pixel ratio capped for canvas backing stores.
 *
 * A 250–300% display would otherwise allocate a surface two to three times
 * larger than a 200% display for no visible sharpness gain.
 */
export function canvasPixelRatio(ratio = globalThis.devicePixelRatio || 1): number {
  const value = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  return Math.min(MAX_CANVAS_PIXEL_RATIO, value);
}

/**
 * The canvas's 2D context, or a localized error when the browser cannot create
 * one.
 */
export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error(t("editorPanels.timeline.canvasContext"));
  }
  return context;
}

/** Logical canvas size in CSS pixels. */
export interface CanvasMeasurement {
  readonly width: number;
  readonly height: number;
}

interface CachedMeasurement extends CanvasMeasurement {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly ratio: number;
}

const measurements = new WeakMap<HTMLCanvasElement, CachedMeasurement>();

/** Minimal element shape whose layout rectangle can be cached. */
export interface MeasurableElement {
  readonly clientWidth?: number;
  readonly clientHeight?: number;
  getBoundingClientRect(): DOMRect;
}

/** Cached CSS-pixel rectangle for one element. */
export interface MeasuredElementRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

interface CachedElementRect extends MeasuredElementRect {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly generation: number;
}

let layoutGeneration = 0;
let layoutListenerAttached = false;
const elementRects = new WeakMap<object, CachedElementRect>();

/** Bump the layout generation so cached element rectangles are re-read. */
export function invalidateElementMeasurements(): void {
  layoutGeneration += 1;
}

/** Re-read element rectangles after a viewport resize or scroll. */
function ensureLayoutListener(): void {
  if (layoutListenerAttached || typeof window === "undefined") {
    return;
  }
  layoutListenerAttached = true;
  const invalidate = () => invalidateElementMeasurements();
  window.addEventListener("resize", invalidate, { passive: true });
  window.addEventListener("scroll", invalidate, { passive: true, capture: true });
}

/**
 * Read an element's layout rectangle once per size and layout generation.
 *
 * Frame paths need positions relative to another panel, not just sizes. Reading
 * that rectangle forces layout, so the cache is invalidated by window resize or
 * scroll and by an element's own CSS size change.
 */
export function measureElementRect(element: MeasurableElement): MeasuredElementRect {
  ensureLayoutListener();
  const cssWidth = element.clientWidth ?? 0;
  const cssHeight = element.clientHeight ?? 0;
  const cached = elementRects.get(element);
  if (
    cached &&
    cached.cssWidth === cssWidth &&
    cached.cssHeight === cssHeight &&
    cached.generation === layoutGeneration
  ) {
    return cached;
  }
  const rectangle = element.getBoundingClientRect();
  const next: CachedElementRect = {
    left: rectangle.left,
    top: rectangle.top,
    right: rectangle.right,
    bottom: rectangle.bottom,
    width: rectangle.width,
    height: rectangle.height,
    cssWidth,
    cssHeight,
    generation: layoutGeneration,
  };
  elementRects.set(element, next);
  return next;
}

/**
 * Measure a canvas once per CSS size and device pixel ratio.
 *
 * The per-frame path reads the cheap layout metrics first and only falls back
 * to `getBoundingClientRect()` when the canvas was resized or moved to another
 * display. A fractional CSS size is preserved while those metrics stay stable.
 */
export function measureCanvas(canvas: HTMLCanvasElement): CanvasMeasurement {
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  const ratio = canvasPixelRatio();
  const cached = measurements.get(canvas);
  if (
    cached &&
    cached.cssWidth === cssWidth &&
    cached.cssHeight === cssHeight &&
    cached.ratio === ratio
  ) {
    return cached;
  }
  const rectangle = canvas.getBoundingClientRect();
  const next: CachedMeasurement = {
    width: rectangle.width,
    height: rectangle.height,
    cssWidth,
    cssHeight,
    ratio,
  };
  measurements.set(canvas, next);
  return next;
}

/** Physical backing-store dimensions plus the capped ratio that produced them. */
export interface CanvasBackingStore extends CanvasMeasurement {
  readonly ratio: number;
}

/**
 * Compute the physical backing-store size for one logical measurement.
 *
 * The ratio is capped by `canvasPixelRatio`, and every axis keeps at least one
 * physical pixel so a zero-sized layout never produces an invalid store.
 */
export function canvasBackingStoreSize(
  measurement: CanvasMeasurement,
  ratio = canvasPixelRatio(),
): CanvasBackingStore {
  const capped = canvasPixelRatio(ratio);
  return {
    width: Math.max(1, Math.round(measurement.width * capped)),
    height: Math.max(1, Math.round(measurement.height * capped)),
    ratio: capped,
  };
}

/**
 * Apply a capped backing-store size without touching the 2D transform.
 * An explicit ratio is reserved for adaptive GPU layers that can reduce pixel
 * work without changing their logical CSS geometry.
 *
 * GPU and cached-layer paths own their own viewport and transform, so they only
 * share the size calculation and the `MAX_CANVAS_PIXEL_RATIO` clamp.
 */
export function sizeCanvasBackingStore(
  canvas: HTMLCanvasElement,
  measurement: CanvasMeasurement,
  ratio = canvasPixelRatio(),
): CanvasBackingStore {
  const size = canvasBackingStoreSize(measurement, ratio);
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width;
    canvas.height = size.height;
  }
  return size;
}

/**
 * Resize the backing store for the device pixel ratio, reset the transform, and
 * optionally clear. Returns the context and the logical size it drew into.
 */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  clear = true,
  measurement?: CanvasMeasurement,
): {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
} {
  const rectangle = measurement ?? measureCanvas(canvas);
  const size = sizeCanvasBackingStore(canvas, rectangle);
  const context = context2d(canvas);
  context.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
  if (clear) {
    context.clearRect(0, 0, rectangle.width, rectangle.height);
  }
  return { context, width: rectangle.width, height: rectangle.height };
}
