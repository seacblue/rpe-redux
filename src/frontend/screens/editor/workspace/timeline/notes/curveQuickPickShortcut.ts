/**
 * Adapts the timeline note pointer event to the configurable curve quick-pick shortcut.
 */
import {
  CURVE_QUICK_PICK_SHORTCUT_ID,
  matchesEditorModifierShortcut,
} from "../../../../../../core/edit/shortcuts/shortcutCatalog.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import { readShortcutContext } from "../../../../../platform/shortcuts/shortcutContext.ts";

/**
 * Match the configured curve-generation modifier for a note pointer event.
 *
 * The passive modifier is evaluated against the pointer event so a configured
 * bare modifier can trigger curve anchor picking without becoming a key command.
 */
export function matchesCurveQuickPickShortcut(
  event: PointerEvent,
  session: EditorSession,
): boolean {
  return matchesEditorModifierShortcut(
    CURVE_QUICK_PICK_SHORTCUT_ID,
    event,
    { area: "notes", hasSelection: Boolean(session.selection.size), surface: "timeline" },
    readShortcutContext(event.target),
  );
}
