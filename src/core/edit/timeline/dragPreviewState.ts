/**
 * The selected object a timeline drag is moving, before the edit commits.
 *
 * The chart and history stay untouched until pointerup. The inspector reads
 * this transient value so its head and tail time fields follow the pointer,
 * and the store reports when the displayed times really changed so a dense
 * drag does not re-render the inspector for every pointer sample.
 */
import type { JudgeLineEvent, JudgeLineNote } from "../../global/chart/chart.ts";
import { compareBeats } from "../../global/chart/timing/beat.ts";

/** A selected note or event whose time fields a pointer drag is previewing. */
export type TimelineDragPreview =
  | { kind: "note"; lineIndex: number; index: number; note: JudgeLineNote }
  | { kind: "event"; lineIndex: number; type: string; index: number; event: JudgeLineEvent };

let active: TimelineDragPreview | null = null;

/** Whether two previews point at the same object and show the same times. */
function samePreview(left: TimelineDragPreview | null, right: TimelineDragPreview | null): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "note" && right.kind === "note") {
    return (
      left.lineIndex === right.lineIndex &&
      left.index === right.index &&
      compareBeats(left.note.startTime, right.note.startTime) === 0 &&
      compareBeats(left.note.endTime, right.note.endTime) === 0
    );
  }
  if (left.kind === "event" && right.kind === "event") {
    return (
      left.lineIndex === right.lineIndex &&
      left.type === right.type &&
      left.index === right.index &&
      compareBeats(left.event.startTime, right.event.startTime) === 0 &&
      compareBeats(left.event.endTime, right.event.endTime) === 0
    );
  }
  return false;
}

/**
 * Replace the active drag preview.
 *
 * Returns true only when the displayed head or tail time changed, so callers
 * can refresh the inspector once per snapped row instead of once per sample.
 */
export function setTimelineDragPreview(preview: TimelineDragPreview | null): boolean {
  if (samePreview(active, preview)) {
    return false;
  }
  active = preview;
  return true;
}

/** The active drag preview, or null when no pointer drag owns the inspector. */
export function timelineDragPreview(): TimelineDragPreview | null {
  return active;
}
