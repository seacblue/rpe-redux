/** Adds a note at the pointer for the keyboard and menu insert commands. */
import { placeTimelineNote } from "../../../../../../core/edit/timeline/placement.ts";
import type { TimelineNoteInsertionReceiver } from "../drawing/timelineReceiver.ts";

/** Place a note of `type` at the cursor; returns false when nothing can be placed. */
export function addAtCursor(this: TimelineNoteInsertionReceiver, type: number): boolean {
  const session = this.getSession();
  if (!session.editable || !this.gestures.cursor) {
    return false;
  }
  // A merged field draws every selected line in one lane, so the active line is
  // the only line the pointer can address; a panel index left over from a split
  // layout must not retarget the note.
  const requestedLine =
    session.notesMode === "multi_merged"
      ? session.lineIndex
      : (this.gestures.cursorLineIndex ??
        (type === 2
          ? this.viewport.lineIndexAt(this.gestures.cursor.x, this.notesCanvas.clientWidth, "notes")
          : session.lineIndex));
  const beat = this.viewport.snappedBeat(this.gestures.cursor.y);
  const positionX = this.viewport.notePositionAt(this.gestures.cursor.x, requestedLine);
  this.gestures.pendingHold = placeTimelineNote(
    session,
    type,
    beat,
    positionX,
    requestedLine,
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
