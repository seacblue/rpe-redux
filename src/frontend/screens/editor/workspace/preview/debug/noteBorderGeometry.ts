/**
 * Pure polygons for the developer note-border overlay.
 *
 * A note is one oriented rectangle. A Hold is split into head, body, and tail
 * rectangles so the debug overlay can mark the three painted parts and the
 * pointer can hit-test the same shapes the canvas draws.
 */
import type { PreviewObject, PreviewPoint } from "../../../../../../core/edit/preview/api.ts";

/** Which part of a preview object one polygon describes. */
export type NoteBorderPart = "note" | "hold-head" | "hold-body" | "hold-tail";

/** One debug border polygon in preview-surface CSS pixels. */
export interface NoteBorderPolygon {
  readonly part: NoteBorderPart;
  readonly points: readonly PreviewPoint[];
}

/** Rotate one local offset into the surface's axes. */
function rotate(dx: number, dy: number, degrees: number): PreviewPoint {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { x: dx * cosine - dy * sine, y: dx * sine + dy * cosine };
}

/** A rotated rectangle around one centre. */
function rectangle(
  center: PreviewPoint,
  width: number,
  height: number,
  rotation: number,
): readonly PreviewPoint[] {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const corners = [
    rotate(-halfWidth, -halfHeight, rotation),
    rotate(halfWidth, -halfHeight, rotation),
    rotate(halfWidth, halfHeight, rotation),
    rotate(-halfWidth, halfHeight, rotation),
  ];
  return corners.map((corner) => ({ x: center.x + corner.x, y: center.y + corner.y }));
}

/** One Hold segment from `start` to `end` along its head-to-tail axis. */
function holdSegment(
  head: PreviewPoint,
  ux: number,
  uy: number,
  width: number,
  start: number,
  end: number,
): readonly PreviewPoint[] {
  const midpoint = (start + end) / 2;
  const halfLength = (end - start) / 2;
  const halfWidth = width / 2;
  const center = { x: head.x + ux * midpoint, y: head.y + uy * midpoint };
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
  if (length < 0.5) {
    return [
      {
        part: "hold-head",
        points: rectangle(head, object.width, object.width, object.rotation),
      },
    ];
  }
  const ux = dx / length;
  const uy = dy / length;
  const width = Math.max(1, object.width);
  // A Hold cap is roughly square; short holds keep three visible parts by
  // splitting evenly instead of letting the body collapse to zero.
  const cap = Math.max(1, Math.min(width, length / 3));
  const bodyStart = cap;
  const bodyEnd = Math.max(cap, length - cap);
  const polygons: NoteBorderPolygon[] = [
    { part: "hold-head", points: holdSegment(head, ux, uy, width, 0, cap) },
  ];
  if (bodyEnd - bodyStart > 0.01) {
    polygons.push({
      part: "hold-body",
      points: holdSegment(head, ux, uy, width, bodyStart, bodyEnd),
    });
  }
  polygons.push({
    part: "hold-tail",
    points: holdSegment(head, ux, uy, width, bodyEnd, length),
  });
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
