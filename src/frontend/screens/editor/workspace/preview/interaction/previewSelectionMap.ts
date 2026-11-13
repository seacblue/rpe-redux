/** Caches the preview's immutable selection projection between render frames. */
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import { cloneSelection } from "./previewNoteSelection.ts";

const selectionMapCache = new WeakMap<object, Map<number, Set<number>>>();

/** Whether two index sets hold the same selected indices. */
function sameIndexSet(left: ReadonlySet<number> | undefined, right: ReadonlySet<number>): boolean {
  if (!left || left.size !== right.size) {
    return false;
  }
  for (const index of left) {
    if (!right.has(index)) {
      return false;
    }
  }
  return true;
}

/**
 * Whether `value` still equals what `cloneSelection(session)` would return.
 *
 * Session code mutates its selection sets in place, so set identity and
 * `selectionRevision` alone cannot invalidate this cache; compare the content
 * instead. The walk allocates nothing, which keeps the frame path cheap.
 */
function matchesSelection(
  session: EditorSession,
  value: ReadonlyMap<number, ReadonlySet<number>>,
): boolean {
  if (session.multiLineActive && session.multiLineMode === "notes") {
    if (value.size !== session.multiLineSelection.size) {
      return false;
    }
    for (const [lineIndex, selected] of value) {
      const current = session.multiLineSelection.get(lineIndex);
      if (!current || !sameIndexSet(selected, current)) {
        return false;
      }
    }
    return true;
  }
  return value.size === 1 && sameIndexSet(value.get(session.lineIndex), session.selection);
}

/** Return a stable private selection map until the session selection content changes. */
export function selectionMapForSession(session: EditorSession): Map<number, Set<number>> {
  const cached = selectionMapCache.get(session);
  if (cached && matchesSelection(session, cached)) {
    return cached;
  }
  const value = cloneSelection(session);
  selectionMapCache.set(session, value);
  return value;
}
