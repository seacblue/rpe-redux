/**
 * Pure polygons for the developer note-border overlay.
 *
 * A note is one oriented rectangle. A Hold is split into its painted head cap,
 * full body span, and tail cap using the renderer's actual cap lengths, so the
 * overlay follows note rotation and zero-length static Holds.
 */
import type { PreviewObject, PreviewPoint } from "../../../../../../core/edit/preview/api.ts";

/** Which part of a preview object one polygon describes. */
export type NoteBorderPart = "note" | "hold-head" | "hold-body" | "hold-tail";

/** One debug border polygon in preview-surface CSS pixels. */
export interface NoteBorderPolygon {
  readonly part: NoteBorderPart;
  readonly points: readonly PreviewPoint[];
}

/** One Hold segment from `start` to `end` along its head-to-tail axis. */
function holdSegment(
  anchor: PreviewPoint,
  ux: number,
  uy: number,
  width: number,
  start: number,
  end: number,
): readonly PreviewPoint[] {
  const midpoint = (start + end) / 2;
  const halfLength = (end - start) / 2;
  const halfWidth = width / 2;
  const center = { x: anchor.x + ux * midpoint, y: anchor.y + uy * midpoint };
  return [
    {
      x: center.x - ux * halfLength - uy * halfWidth,
      y: center.y - uy * halfLength + ux * halfWidth,
    },
    {
      x: center.x + ux * halfLength - uy * halfWidth,
      y: center.y + uy * halfLength + ux * halfWidth,
    },
    {
      x: center.x + ux * halfLength + uy * halfWidth,
      y: center.y + uy * halfLength - ux * halfWidth,
    },
    {
      x: center.x - ux * halfLength + uy * halfWidth,
      y: center.y - uy * halfLength - ux * halfWidth,
    },
  ];
}

/**
 * Direction from the Hold head to its tail in surface axes.
 *
 * A zero-length Hold has no painted axis, so its caps follow the line's fall
 * direction: local +Y rotated by the line angle and flipped for a note below
 * the judge line.
 */
function holdAxisDirection(object: PreviewObject, dx: number, dy: number): PreviewPoint {
  const length = Math.hypot(dx, dy);
  if (length > 0.5) {
    return { x: dx / length, y: dy / length };
  }
  const above = Number(object.debug?.above ?? 1) === 1;
  const radians = ((object.rotation + (above ? 180 : 0)) * Math.PI) / 180;
  return { x: -Math.sin(radians), y: Math.cos(radians) };
}

/** A painted cap length, or a small fallback when the renderer supplied none. */
function holdCapLength(length: number | undefined, width: number): number {
  return length !== undefined && length > 0 ? length : Math.max(1, Math.min(4, width));
}

/** Every debug border polygon for one preview object. */
export function noteBorderPolygons(object: PreviewObject): readonly NoteBorderPolygon[] {
  if (object.kind === "note") {
    return [{ part: "note", points: object.surface.corners }];
  }
  if (object.kind !== "hold") {
    return [];
  }
  const { head, tail } = object.surface;
  const dx = tail.x - head.x;
  const dy = tail.y - head.y;
  const length = Math.hypot(dx, dy);
  const direction = holdAxisDirection(object, dx, dy);
  const width = Math.max(1, object.width);
  const headLength = object.showHead === false ? 0 : holdCapLength(object.headLength, width);
  const tailLength = holdCapLength(object.tailLength, width);
  const polygons: NoteBorderPolygon[] = [];
  // The body spans the anchors; each cap is centred half a cap outside them,
  // matching the sprite layout in the preview renderer.
  if (length > 0.5) {
    polygons.push({
      part: "hold-body",
      points: holdSegment(head, direction.x, direction.y, width, 0, length),
    });
  }
  if (headLength > 0) {
    polygons.push({
      part: "hold-head",
      points: holdSegment(head, direction.x, direction.y, width, -headLength, 0),
    });
  }
  if (tailLength > 0) {
    polygons.push({
      part: "hold-tail",
      points: holdSegment(tail, direction.x, direction.y, width, 0, tailLength),
    });
  }
  return polygons;
}

/** Ray-cast point-in-polygon test over one debug rectangle. */
export function pointInPolygon(point: PreviewPoint, polygon: readonly PreviewPoint[]): boolean {
  let inside = false;
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current++
  ) {
    const a = polygon[current];
    const b = polygon[previous];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Squared distance from a point to one line segment. */
function distanceSquaredToSegment(
  point: PreviewPoint,
  start: PreviewPoint,
  end: PreviewPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  }
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  const x = start.x + t * dx;
  const y = start.y + t * dy;
  return (point.x - x) ** 2 + (point.y - y) ** 2;
}

/** Whether a point is inside a polygon or within `tolerance` of its edge. */
export function pointHitsPolygon(
  point: PreviewPoint,
  polygon: readonly PreviewPoint[],
  tolerance = 3,
): boolean {
  if (pointInPolygon(point, polygon)) {
    return true;
  }
  const limit = tolerance * tolerance;
  for (let index = 0; index < polygon.length; index += 1) {
    if (
      distanceSquaredToSegment(point, polygon[index], polygon[(index + 1) % polygon.length]) <=
      limit
    ) {
      return true;
    }
  }
  return false;
}

/** The topmost note or Hold whose border contains `point`, or null. */
export function noteBorderHit(
  objects: readonly PreviewObject[],
  point: PreviewPoint,
  tolerance = 3,
): PreviewObject | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index];
    if (object.kind !== "note" && object.kind !== "hold") {
      continue;
    }
    if (
      noteBorderPolygons(object).some((polygon) =>
        pointHitsPolygon(point, polygon.points, tolerance),
      )
    ) {
      return object;
    }
  }
  return null;
}
