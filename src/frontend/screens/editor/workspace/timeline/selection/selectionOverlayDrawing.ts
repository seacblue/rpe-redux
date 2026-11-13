/**
 * Paints the transient marquee without touching timeline object rendering.
 *
 * One geometry resolution feeds both sinks: the Canvas2D painter and the WebGL
 * queue functions, so a marquee rectangle or sweep keeps one projection.
 */
import type { TimelineOverlayBatch } from "../../../canvas/timelineOverlayBatch.ts";

export type MarqueeArea = "notes" | "events";

export interface MarqueePalette {
  readonly selectionNotesFill: string;
  readonly selectionNotesStroke: string;
  readonly selectionEventsFill: string;
  readonly selectionEventsStroke: string;
}

export interface MarqueePoint {
  readonly x: number;
  readonly y: number;
}

export interface MarqueeOrigin {
  readonly left: number;
  readonly top: number;
}

const MARQUEE_DASH = [6, 4];

/** One marquee rectangle in overlay-local coordinates plus its paint inputs. */
interface MarqueeRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: string;
  readonly stroke: string;
  /** Half-pixel offset that keeps the preview outline crisp. */
  readonly offset: number;
  readonly strokeWidth: number;
}

/** Resolve a signed drag into the overlay-local rectangle and its colours. */
function marqueeRectangleGeometry(
  origin: MarqueeOrigin,
  overlay: MarqueeOrigin,
  start: MarqueePoint,
  current: MarqueePoint,
  area: MarqueeArea,
  palette: MarqueePalette,
  preview: boolean,
): MarqueeRectangle {
  let x = origin.left - overlay.left + start.x;
  let y = origin.top - overlay.top + start.y;
  let width = current.x - start.x;
  let height = current.y - start.y;
  if (preview) {
    x += Math.min(0, width);
    y += Math.min(0, height);
    width = Math.abs(width);
    height = Math.abs(height);
  }
  return {
    x,
    y,
    width,
    height,
    fill: area === "notes" ? palette.selectionNotesFill : palette.selectionEventsFill,
    stroke: area === "notes" ? palette.selectionNotesStroke : palette.selectionEventsStroke,
    offset: preview ? 0.5 : 0,
    strokeWidth: preview ? 1 : 1.5,
  };
}

/** Project one drag point into overlay-local coordinates. */
function marqueeSweepPoint(
  origin: MarqueeOrigin,
  overlay: MarqueeOrigin,
  point: MarqueePoint,
  target: number[],
): void {
  target.push(origin.left - overlay.left + point.x, origin.top - overlay.top + point.y);
}

/** Flat [x, y, ...] sweep path in overlay-local coordinates. */
function marqueeSweepPoints(
  origin: MarqueeOrigin,
  overlay: MarqueeOrigin,
  points: readonly MarqueePoint[],
): number[] {
  const projected: number[] = [];
  for (const point of points) {
    marqueeSweepPoint(origin, overlay, point, projected);
  }
  return projected;
}

/** Paint one marquee rectangle in overlay-local coordinates. */
export function drawMarqueeRectangle(
  context: CanvasRenderingContext2D,
  origin: MarqueeOrigin,
  overlay: MarqueeOrigin,
  start: MarqueePoint,
  current: MarqueePoint,
  area: MarqueeArea,
  palette: MarqueePalette,
  preview = false,
): void {
  const rectangle = marqueeRectangleGeometry(
    origin,
    overlay,
    start,
    current,
    area,
    palette,
    preview,
  );
  context.save();
  context.fillStyle = rectangle.fill;
  context.strokeStyle = rectangle.stroke;
  context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  context.setLineDash(MARQUEE_DASH);
  context.lineWidth = rectangle.strokeWidth;
  context.strokeRect(
    rectangle.x + rectangle.offset,
    rectangle.y + rectangle.offset,
    rectangle.width,
    rectangle.height,
  );
  context.restore();
}

/** Queue one marquee rectangle for the WebGL overlay. */
export function queueMarqueeRectangle(
  batch: TimelineOverlayBatch,
  origin: MarqueeOrigin,
  overlay: MarqueeOrigin,
  start: MarqueePoint,
  current: MarqueePoint,
  area: MarqueeArea,
  palette: MarqueePalette,
  preview = false,
): void {
  const rectangle = marqueeRectangleGeometry(
    origin,
    overlay,
    start,
    current,
    area,
    palette,
    preview,
  );
  batch.addRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height, rectangle.fill);
  batch.addStrokeRect(
    rectangle.x + rectangle.offset,
    rectangle.y + rectangle.offset,
    rectangle.width,
    rectangle.height,
    rectangle.stroke,
    rectangle.strokeWidth,
  );
}

/** Paint one freehand sweep path in overlay-local coordinates. */
export function drawSelectionSweep(
  context: CanvasRenderingContext2D,
  origin: MarqueeOrigin,
  overlay: MarqueeOrigin,
  points: readonly MarqueePoint[],
  area: MarqueeArea,
  palette: MarqueePalette,
  strokeColor?: string,
): void {
  if (points.length < 2) {
    return;
  }
  const projected = marqueeSweepPoints(origin, overlay, points);
  context.save();
  context.beginPath();
  for (let index = 0; index < projected.length; index += 2) {
    if (index === 0) {
      context.moveTo(projected[index] ?? 0, projected[index + 1] ?? 0);
    } else {
      context.lineTo(projected[index] ?? 0, projected[index + 1] ?? 0);
    }
  }
  context.strokeStyle =
    strokeColor ??
    (area === "notes" ? palette.selectionNotesStroke : palette.selectionEventsStroke);
  context.lineWidth = 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash([]);
  context.stroke();
  context.restore();
}

/** Queue the freehand sweep as a GPU polyline in overlay-local coordinates. */
export function queueSelectionSweep(
  batch: TimelineOverlayBatch,
  origin: MarqueeOrigin,
  overlay: MarqueeOrigin,
  points: readonly MarqueePoint[],
  area: MarqueeArea,
  palette: MarqueePalette,
  strokeColor?: string,
): void {
  if (points.length < 2) {
    return;
  }
  batch.addPolyline(
    marqueeSweepPoints(origin, overlay, points),
    strokeColor ??
      (area === "notes" ? palette.selectionNotesStroke : palette.selectionEventsStroke),
    2,
  );
}
