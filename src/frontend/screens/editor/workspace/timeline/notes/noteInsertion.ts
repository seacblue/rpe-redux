/** Adds a note at the pointer for the keyboard and menu insert commands. */
import { placeTimelineNote } from "../../../../../../core/edit/timeline/placement.ts";
import { resolveMergedNoteLine } from "../../../../../../core/edit/timeline/noteCommands.ts";
import type { TimelineNoteInsertionReceiver } from "../drawing/timelineReceiver.ts";

/** Place a note of `type` at the cursor; returns false when nothing can be placed. */
export function addAtCursor(this: TimelineNoteInsertionReceiver, type: number): boolean {
  if (!this.getSession().editable || !this.gestures.cursor) {
    return false;
  }
  const requestedLine =
    this.gestures.cursorLineIndex ??
    (type === 2
      ? this.viewport.lineIndexAt(this.gestures.cursor.x, this.notesCanvas.clientWidth, "notes")
      : this.getSession().lineIndex);
  const beat = this.viewport.snappedBeat(this.gestures.cursor.y);
  const lineIndex = resolveMergedNoteLine(this.getSession(), beat, requestedLine);
  const positionX = this.viewport.notePositionAt(this.gestures.cursor.x, lineIndex);
  this.gestures.pendingHold = placeTimelineNote(
    this.getSession(),
    type,
    beat,
    positionX,
    lineIndex,
    this.gestures.pendingHold,
  );
  if (!Number.isFinite(positionX)) {
    return false;
  }
  if (type === 2) {
    this.changed();
  }
  return true;
}
