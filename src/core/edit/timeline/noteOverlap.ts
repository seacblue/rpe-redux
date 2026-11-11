/**
 * Marks same-beat, non-Hold notes that are close enough to overlap in the note
 * field and gives each overlap stack a stable rotation order.
 *
 * "Close" is expressed in chart units because the lanes are authored in that
 * space. The threshold is a fixed distance rather than a multiple of the X-axis
 * grid spacing, so changing the snap lane count does not change which notes are
 * marked. The settings row that owns the value starts at
 * `DEFAULT_NOTE_OVERLAP_THRESHOLD`. Beat ties use the same epsilon as the event
 * overlap sweep, since beat triples are exact rationals that may be unnormalised.
 */

import { beatValue } from "../../global/chart/timing/beat.ts";
import type { TimelineNote } from "./types.ts";

const SAME_BEAT_EPSILON = 1e-8;

/** Default distance, in chart units, that marks two same-beat notes as overlapping. */
export const DEFAULT_NOTE_OVERLAP_THRESHOLD = 100;

/** A note's 0-based position inside one same-beat overlap stack. */
export type NoteOverlapRanks = ReadonlyMap<number, number>;

/**
 * Positions (not note indices) in `notes` that share a beat and lie within
 * `thresholdX` chart units of another non-Hold note, mapped to their 0-based
 * order inside that stack.
 *
 * Notes are ordered by X and then chart position, so the leftmost note of a
 * stack receives rank 0. A note without a same-beat neighbour is absent from
 * the map and keeps its unrotated paint and hit box. A non-positive threshold
 * turns the marking off.
 */
export function overlappingNoteRanks(
  notes: readonly TimelineNote[],
  thresholdX: number,
): NoteOverlapRanks {
  const ranks = new Map<number, number>();
  if (!(thresholdX > 0) || notes.length < 2) {
    return ranks;
  }
  const candidates: Array<{ position: number; beat: number; x: number }> = [];
  notes.forEach((note, position) => {
    // A Hold's body is meant to span time and is excluded by definition.
    if (Number(note.type) === 2) {
      return;
    }
    candidates.push({ position, beat: beatValue(note.startTime), x: note.positionX });
  });
  candidates.sort(
    (left, right) => left.beat - right.beat || left.x - right.x || left.position - right.position,
  );
  let first = 0;
  while (first < candidates.length) {
    let beatEnd = first;
    while (
      beatEnd + 1 < candidates.length &&
      candidates[beatEnd + 1].beat - candidates[first].beat <= SAME_BEAT_EPSILON
    ) {
      beatEnd += 1;
    }
    // Each same-beat run is split into connected X clusters. A cluster is one
    // visual stack, so separate stacks on the same beat both start at rank 0.
    let clusterStart = first;
    for (let index = first + 1; index <= beatEnd + 1; index += 1) {
      const separates =
        index > beatEnd || candidates[index].x - candidates[index - 1].x >= thresholdX;
      if (!separates) {
        continue;
      }
      if (index - clusterStart > 1) {
        for (let member = clusterStart; member < index; member += 1) {
          ranks.set(candidates[member].position, member - clusterStart);
        }
      }
      clusterStart = index;
    }
    first = beatEnd + 1;
  }
  return ranks;
}
