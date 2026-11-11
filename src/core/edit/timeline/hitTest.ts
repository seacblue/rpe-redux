/**
 * Which note a point is over. The rule is here so the pointer layer and the
 * readouts cannot disagree about it; the geometry it needs is passed in, because
 * the callers already have the viewport and this module owns no layout.
 */

import type { TimelineNote, TimelineNoteEntry, TimelinePoint } from "./types.ts";

export interface NoteHitGeometry {
  horizontal(note: TimelineNote, lineIndex: number): number;
  width(note: TimelineNote): number;
  /** Half the visible height of a note head, for precise overlap picking. */
  halfHeight?(note: TimelineNote, width: number): number;
  visible(horizontal: number, width: number, lineIndex: number): boolean;
  vertical(beat: number, lineIndex: number): number;
  /** Paint rotation in radians for this note; Holds remain axis-aligned. */
  rotation?(index: number, lineIndex: number): number;
}

/** Returns every note under the point, nearest first and non-holds before holds. */
export function timelineNoteCandidates(
  entries: TimelineNoteEntry[],
  point: TimelinePoint,
  geometry: NoteHitGeometry,
  precise = false,
): TimelineNoteEntry[] {
  const matches = (entry: TimelineNoteEntry): boolean => {
    const x = geometry.horizontal(entry.item, entry.lineIndex);
    const width = geometry.width(entry.item);
    const startY = geometry.vertical(entry.start, entry.lineIndex);
    const endY = geometry.vertical(entry.end, entry.lineIndex);
    const padding = precise ? Math.max(0, geometry.halfHeight?.(entry.item, width) ?? 4) : 9;
    if (!geometry.visible(x, width, entry.lineIndex)) {
      return false;
    }
    const rotation =
      entry.item.type === 2 ? 0 : (geometry.rotation?.(entry.index, entry.lineIndex) ?? 0);
    if (rotation !== 0) {
      // Picking follows the rotated head, so the visible end of each note in a
      // stack selects that note instead of the whole stack's bounding box.
      const cosine = Math.cos(rotation);
      const sine = Math.sin(rotation);
      const offsetX = point.x - x;
      const offsetY = point.y - startY;
      const localX = offsetX * cosine + offsetY * sine;
      const localY = -offsetX * sine + offsetY * cosine;
      return Math.abs(localX) <= width / 2 && Math.abs(localY) <= padding;
    }
    const top = Math.min(startY, endY) - padding;
    const bottom = Math.max(startY, endY) + padding;
    return Math.abs(x - point.x) <= width / 2 && point.y >= top && point.y <= bottom;
  };
  // Same-beat notes may overlap each other. The pointer picks the note whose
  // centre is nearest; ties keep chart order, with non-holds before holds.
  const candidates: { entry: TimelineNoteEntry; distance: number }[] = [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (!matches(entry)) {
      continue;
    }
    candidates.push({
      entry,
      distance: Math.abs(geometry.horizontal(entry.item, entry.lineIndex) - point.x),
    });
  }
  return candidates
    .sort(
      (left, right) =>
        Number(left.entry.item.type === 2) - Number(right.entry.item.type === 2) ||
        left.distance - right.distance,
    )
    .map(({ entry }) => entry);
}

/** Returns the topmost note under the point, or undefined when none matches. */
export function hitTimelineNote(
  entries: TimelineNoteEntry[],
  point: TimelinePoint,
  geometry: NoteHitGeometry,
): TimelineNoteEntry | undefined {
  return timelineNoteCandidates(entries, point, geometry)[0];
}
