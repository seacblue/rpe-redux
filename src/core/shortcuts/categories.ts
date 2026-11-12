/**
 * The built-in shortcut categories shared by feature registrations.
 *
 * A category is only the label and order the shortcut editor uses. It is not a
 * toolbar group: no popup and no dispatch table is derived from it. The order
 * stays comparable across every contributor, so the settings page can list the
 * groups in one product-wide sequence instead of registration order.
 */
import type { ShortcutCategory } from "./types.ts";

/** Standard shortcut-editor categories supplied by the application. */
export const SHORTCUT_CATEGORIES = Object.freeze({
  file: { id: "file", title: "shortcuts.category.file", order: 10 },
  workspace: { id: "workspace", title: "shortcuts.category.workspace", order: 20 },
  editorEditing: {
    id: "editor.editing",
    title: "shortcuts.category.editorEditing",
    order: 30,
  },
  editorNotes: {
    id: "editor.notes",
    title: "shortcuts.category.editorNotes",
    order: 40,
  },
  editorSelection: {
    id: "editor.selection",
    title: "shortcuts.category.editorSelection",
    order: 50,
  },
  editorClipboard: {
    id: "editor.clipboard",
    title: "shortcuts.category.editorClipboard",
    order: 60,
  },
  editorNavigation: {
    id: "editor.navigation",
    title: "shortcuts.category.editorNavigation",
    order: 70,
  },
  editorPlayback: {
    id: "editor.playback",
    title: "shortcuts.category.editorPlayback",
    order: 80,
  },
  editorCurve: {
    id: "editor.curve",
    title: "shortcuts.category.editorCurve",
    order: 90,
  },
  sampling: { id: "sampling", title: "shortcuts.category.sampling", order: 100 },
  developer: { id: "developer", title: "shortcuts.category.developer", order: 120 },
} satisfies Record<string, ShortcutCategory>);

/**
 * Compare two categories for display.
 *
 * Registration order breaks ties so two contributors that declare the same
 * order keep a stable list rather than swapping between renders.
 */
export function compareShortcutCategories(left: ShortcutCategory, right: ShortcutCategory): number {
  return left.order - right.order;
}
