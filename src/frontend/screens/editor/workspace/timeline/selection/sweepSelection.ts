/** Resolves the configurable left/right timeline sweep gesture. */
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import { matchesEditorShortcut } from "../../../../../../core/edit/shortcuts/shortcutCatalog.ts";
import type { TimelineArea } from "../../../../../../core/edit/timeline/types.ts";
import { readShortcutContext } from "../../../../../platform/shortcuts/shortcutContext.ts";

export type SweepMode = "add" | "remove";

/** Resolve the passive sweep shortcut currently held by a timeline pointer. */
export function timelineSweepMode(
  session: EditorSession,
  event: PointerEvent,
  area: TimelineArea,
): SweepMode | null {
  const context = readShortcutContext(event.target);
  const shortcutContext = {
    area,
    hasSelection: Boolean(
      session.selection.size ||
      session.eventSelection.size ||
      [...session.multiLineSelection.values()].some((selection) => selection.size) ||
      [...session.multiEventSelection.values()].some((selection) => selection.size),
    ),
    hasEventSelection: Boolean(
      session.eventSelection.size ||
      [...session.multiEventSelection.values()].some((selection) => selection.size),
    ),
    surface: "timeline" as const,
  };
  if (matchesEditorShortcut("selection.sweep.remove", event, shortcutContext, context)) {
    return "remove";
  }
  if (matchesEditorShortcut("selection.sweep.add", event, shortcutContext, context)) {
    return "add";
  }
  return null;
}

/** Clear the opposite timeline area before a sweep starts. */
export function lockSweepArea(session: EditorSession, area: TimelineArea): void {
  session.focus = area;
  session.marqueeSelection = area;
  session.multiSelectionIntent = area;
  session.selectionRevision += 1;
  if (area === "notes") {
    session.eventSelection.clear();
    session.multiEventSelection.clear();
  } else {
    session.selection.clear();
    session.multiLineSelection.clear();
  }
}
