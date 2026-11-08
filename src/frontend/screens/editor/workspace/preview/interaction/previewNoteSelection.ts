/**
 * Applies preview note selections to the editor session.
 *
 * Preview gestures select notes, not judge lines. The session's selected lines
 * are replaced by the lines that own the selected notes, so a click or marquee
 * never keeps an unrelated line selected. The module stays free of canvas and
 * DOM imports so the selection rules can be verified on their own.
 */
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";

/** Copies the session's current note selection into a private map. */
export function cloneSelection(session: EditorSession): Map<number, Set<number>> {
  if (session.multiLineActive && session.multiLineMode === "notes") {
    return new Map(
      [...session.multiLineSelection].map(([lineIndex, indices]) => [lineIndex, new Set(indices)]),
    );
  }
  return new Map([[session.lineIndex, new Set(session.selection)]]);
}

/** Whether the session already holds exactly `next` as its note selection. */
export function sameSelection(session: EditorSession, next: Map<number, Set<number>>): boolean {
  if (session.focus !== "notes") {
    return false;
  }
  if (session.eventSelection.size || session.multiEventSelection.size) {
    return false;
  }
  if (next.size > 1) {
    if (!session.multiLineActive || session.multiLineMode !== "notes") {
      return false;
    }
    // The selected lines must be exactly the lines that own the selected
    // notes; a stale extra line means this is not the same selection.
    const lines = [...next.keys()].sort((left, right) => left - right);
    if (
      !next.has(session.lineIndex) ||
      session.multiLineIndices.length !== lines.length ||
      session.multiLineIndices.some((lineIndex, position) => lineIndex !== lines[position])
    ) {
      return false;
    }
  } else if (session.multiLineActive) {
    return false;
  }
  const current =
    next.size > 1
      ? session.multiLineSelection
      : new Map([[session.lineIndex, session.selection as ReadonlySet<number>]]);
  if (current.size !== next.size) {
    return false;
  }
  for (const [lineIndex, indices] of next) {
    const existing = current.get(lineIndex);
    if (!existing || existing.size !== indices.size) {
      return false;
    }
    for (const index of indices) {
      if (!existing.has(index)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Writes a note selection into the session, replacing the selected judge lines
 * with the lines that own the selected notes.
 */
export function applySelection(
  session: EditorSession,
  next: Map<number, Set<number>>,
  notify = true,
  marquee = false,
): void {
  const intent = marquee ? "notes" : null;
  const hasSelection = [...next.values()].some((indices) => indices.size > 0);
  const nextMode = !hasSelection ? "none" : marquee ? "multi" : "single";
  const intentChanged = session.marqueeSelection !== intent;
  const modeChanged = session.selectionMode !== nextMode;
  if (sameSelection(session, next) && !intentChanged && !modeChanged) {
    return;
  }
  session.selectionMode = nextMode;
  session.marqueeSelection = intent;
  if (intentChanged) {
    session.selectionRevision += 1;
  }
  const lines = [...next.keys()].sort((left, right) => left - right);
  session.focus = "notes";
  session.eventSelection.clear();
  session.multiEventSelection.clear();
  if (lines.length > 1) {
    if (!next.has(session.lineIndex)) {
      session.lineIndex = lines[0];
    }
    session.multiLineEnabled = true;
    session.multiLineMode = "notes";
    session.multiLineIndices = lines;
    session.multiLineSelection = next;
    session.selection = new Set(next.get(session.lineIndex) ?? []);
  } else {
    const lineIndex = lines[0];
    if (lineIndex !== undefined && lineIndex !== session.lineIndex) {
      session.lineIndex = lineIndex;
    }
    session.multiLineSelection.clear();
    session.multiLineIndices = [];
    session.multiLineEnabled = false;
    session.selection = new Set(lineIndex === undefined ? [] : (next.get(lineIndex) ?? []));
  }
  session.normalizeMultiLine();
  if (notify) {
    session.notify();
  }
}
