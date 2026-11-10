/**
 * Builds the ghost notes that preview a curve before it is committed.
 *
 * The preview derives from two anchors and the current curve settings and
 * never touches the chart. It shares `planCurveNotes` with the commit, so an
 * anchor already present in the chart is marked rather than previewed as new,
 * and a curve that fails to generate falls back to drawing just the anchors
 * with the error reported to the caller.
 */
import {
  createCurveAnchorNote,
  curveNoteMatches,
  planCurveNotes,
} from "../../global/chart/editing/curveNotes.ts";
import { compareBeats, type Beat } from "../../global/chart/timing/beat.ts";
import type { CurveAnchor, TimelineNote } from "./types.ts";
import type { JudgeLineNote } from "../../global/chart/chart.ts";

export interface CurveGhostValues {
  startTime: Beat;
  endTime: Beat;
  startX: number;
  endX: number;
  type: number;
  density: number;
  easingType: number;
}

/** Builds the curve preview notes that the timeline renderer overlays on the chart. */
export function buildCurveGhostNotes(
  active: boolean,
  start: CurveAnchor | null | undefined,
  end: CurveAnchor | null | undefined,
  values: CurveGhostValues,
  division: number,
  notes: readonly JudgeLineNote[],
  onError?: (error: unknown) => void,
): TimelineNote[] {
  if (!active || !start) {
    return [];
  }
  /** Converts a planned note into a timeline ghost, marking reused anchors. */
  const ghostNote = (note: JudgeLineNote, existing: boolean): TimelineNote => ({
    ...note,
    positionX: note.positionX ?? values.startX,
    existing,
  });
  /** Draws the anchors alone when generation cannot produce a path. */
  const anchorsOnly = (): TimelineNote[] => {
    const anchors = [createCurveAnchorNote(values.type, values.startTime, values.startX, division)];
    if (end && compareBeats(values.endTime, values.startTime) >= 0) {
      anchors.push(createCurveAnchorNote(values.type, values.endTime, values.endX, division));
    }
    return anchors.map((note) =>
      ghostNote(
        note,
        notes.some((candidate) => curveNoteMatches(candidate, note)),
      ),
    );
  };
  if (!end) {
    return anchorsOnly();
  }
  // A reversed selection is a transient UI state, not an error. Keep the start
  // anchor visible and skip the ghost while the end is before the start.
  if (compareBeats(values.endTime, values.startTime) < 0) {
    return anchorsOnly();
  }
  try {
    const plan = planCurveNotes({ ...values, division, existing: notes });
    return plan.items.map((item) => ghostNote(item.note, item.existing));
  } catch (error) {
    // The ghost is a best-effort preview: keep the anchors drawable, but let
    // the owning surface report the failed generation through its own adapter.
    try {
      onError?.(error);
    } catch {
      // Reporting is isolated so a preview failure stays a preview failure.
    }
    return anchorsOnly();
  }
}
