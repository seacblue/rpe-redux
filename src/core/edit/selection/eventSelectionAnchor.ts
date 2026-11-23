/** Tracks the event that was most recently added to the current selection. */
import type { EditorSession, EventSelectionAnchor } from "../session/session.ts";

/** Remembers one event as the last event added to a selection gesture. */
export function rememberEventSelection(
  session: EditorSession,
  lineIndex: number,
  key: string,
): void {
  session.eventSelectionAnchor = { lineIndex, key };
}

/** Clears the event-selection gesture anchor. */
export function clearEventSelectionAnchor(session: EditorSession): void {
  session.eventSelectionAnchor = null;
}

/** Returns the set that owns event keys for one selected line. */
function selectionForLine(session: EditorSession, lineIndex: number): Set<string> | undefined {
  if (session.multiLineActive && session.multiLineMode === "events") {
    return session.multiEventSelection.get(lineIndex);
  }
  return lineIndex === session.lineIndex ? session.eventSelection : undefined;
}

/** Returns whether an event is still selected after a gesture or edit. */
function isSelected(session: EditorSession, anchor: EventSelectionAnchor): boolean {
  return selectionForLine(session, anchor.lineIndex)?.has(anchor.key) ?? false;
}

/** Returns the valid event anchor, or null when the selection no longer contains it. */
export function selectedEventAnchor(session: EditorSession): EventSelectionAnchor | null {
  const anchor = session.eventSelectionAnchor;
  return anchor && isSelected(session, anchor) ? anchor : null;
}

/** Keeps the anchor valid after an event is removed from the selection. */
export function reconcileEventSelectionAnchor(session: EditorSession): void {
  if (selectedEventAnchor(session)) {
    return;
  }
  session.eventSelectionAnchor = null;
  if (session.eventSelection.size) {
    session.eventSelectionAnchor = {
      lineIndex: session.lineIndex,
      key: [...session.eventSelection].at(-1) as string,
    };
    return;
  }
  for (const [lineIndex, selection] of session.multiEventSelection) {
    const key = [...selection].at(-1);
    if (key !== undefined) {
      session.eventSelectionAnchor = { lineIndex, key };
    }
  }
}
