/** Matches the registered pointer-selection meanings at one editor surface. */
import type {
  EditorShortcutArea,
  EditorShortcutSurface,
} from "../../../../../../core/edit/shortcuts/declarations.ts";
import { matchesEditorShortcut } from "../../../../../../core/edit/shortcuts/shortcutCatalog.ts";
import { readShortcutContext } from "../../../../../platform/shortcuts/shortcutContext.ts";
import type { ShortcutEventLike } from "../../../../../../core/shortcuts/types.ts";

/** Resolve one selection gesture from the live pointer shortcut registry. */
export function matchesSelectionShortcut(
  id: string,
  event: ShortcutEventLike,
  area: EditorShortcutArea,
  surface: EditorShortcutSurface,
  target: EventTarget | null,
): boolean {
  return matchesEditorShortcut(
    id,
    event,
    { area, hasSelection: false, surface },
    readShortcutContext(target),
  );
}
