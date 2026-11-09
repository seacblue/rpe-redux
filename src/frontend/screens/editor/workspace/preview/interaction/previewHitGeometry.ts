/** Precise painted note bounds for disambiguating overlapping preview objects. */
import type { HitTestNoteGeometry, HitTestPoint } from "../../../../../../core/edit/hitTest/api.ts";

/** Test the note's rotated useful rectangle; Hold caps fit inside its anchors. */
export function previewNoteContains(area: HitTestNoteGeometry, point: HitTestPoint): boolean {
  const angle = (area.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  /** Rotates a point into the note's local axes. */
  const project = (value: HitTestPoint) => {
    const x = value.x - area.head.x;
    const y = value.y - area.head.y;
    return { x: x * cos + y * sin, y: -x * sin + y * cos };
  };
  const cursor = project(point);
  if (area.kind === "note") {
    return Math.abs(cursor.x) <= area.width / 2 && Math.abs(cursor.y) <= (area.height ?? 0) / 2;
  }
  const tail = project(area.tail);
  // A zero-length Hold still paints one full cap centred on the anchor, so its
  // picking box keeps the cap overhang; a body Hold stops exactly at the end.
  const halfCap = tail.y === 0 ? Math.max(area.headLength ?? 0, area.tailLength ?? 0) / 2 : 0;
  const progress = tail.y === 0 ? 0 : Math.max(0, Math.min(1, cursor.y / tail.y));
  return (
    Math.abs(cursor.x - tail.x * progress) <= area.width / 2 &&
    cursor.y >= Math.min(0, tail.y) - halfCap &&
    cursor.y <= Math.max(0, tail.y) + halfCap
  );
}
