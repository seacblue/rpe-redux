/**
 * Home-library navigation shortcuts.
 *
 * Q selects the previous visible chart and E the next. They are app-scoped
 * because the home screen has no editor workspace, and they stay inert while a
 * dialog, menu, control popup, or text field owns the keyboard.
 */
import { SHORTCUT_CATEGORIES } from "../../../../core/shortcuts/categories.ts";
import { shortcutRegistry } from "../../../../core/shortcuts/registry.ts";
import type { ShortcutContext, ShortcutDisposer } from "../../../../core/shortcuts/types.ts";

/** Stable ids so the shortcut editor can rebind both commands. */
export const LIBRARY_SHORTCUT_IDS = Object.freeze({
  previous: "library.previous",
  next: "library.next",
});

/** The list walk the two bindings invoke. */
export interface LibraryShortcutHandlers {
  previous(): void;
  next(): void;
}

/** Registers Q/E beside the other workspace commands; returns their disposer. */
export function registerLibraryShortcuts(handlers: LibraryShortcutHandlers): ShortcutDisposer {
  const ownsCategory = !shortcutRegistry.hasCategory(SHORTCUT_CATEGORIES.workspace.id);
  const category = ownsCategory
    ? shortcutRegistry.registerCategory(SHORTCUT_CATEGORIES.workspace)
    : null;
  const categoryId = category?.id ?? SHORTCUT_CATEGORIES.workspace.id;
  /** The library answers only when no other surface has claimed the keyboard. */
  const available = (context: ShortcutContext): boolean =>
    context.atHome && !context.textEntry && context.surface === null;
  const disposePrevious = shortcutRegistry.registerShortcut({
    id: LIBRARY_SHORTCUT_IDS.previous,
    category: categoryId,
    title: "shortcuts.library.previous",
    defaults: [{ key: "Q" }],
    scope: "app",
    // The editor uses Q for placing a Tap; the two never run together, and the
    // shortcut editor should not call the pair a mistake.
    shared: true,
    when: available,
    run: () => handlers.previous(),
  });
  const disposeNext = shortcutRegistry.registerShortcut({
    id: LIBRARY_SHORTCUT_IDS.next,
    category: categoryId,
    title: "shortcuts.library.next",
    defaults: [{ key: "E" }],
    scope: "app",
    shared: true,
    when: available,
    run: () => handlers.next(),
  });
  return () => {
    disposePrevious();
    disposeNext();
    category?.dispose();
  };
}
