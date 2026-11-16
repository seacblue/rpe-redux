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
  seekBackward: "library.seekBackward",
  seekForward: "library.seekForward",
});

/** The list walk the two bindings invoke. */
export interface LibraryShortcutHandlers {
  previous(): void;
  next(): void;
}

/** The two home-preview transport actions bound to the horizontal arrows. */
export interface LibraryPreviewShortcutHandlers {
  seekBackward(): void;
  seekForward(): void;
}

let libraryCategoryUsers = 0;
let ownedLibraryCategoryDisposer: ShortcutDisposer | null = null;

/** Shares the workspace category between the library list and preview transport. */
function acquireLibraryCategory(): { id: string; release(): void } {
  if (
    libraryCategoryUsers === 0 &&
    !shortcutRegistry.hasCategory(SHORTCUT_CATEGORIES.workspace.id)
  ) {
    ownedLibraryCategoryDisposer = shortcutRegistry.registerCategory(
      SHORTCUT_CATEGORIES.workspace,
    ).dispose;
  }
  libraryCategoryUsers += 1;
  return {
    id: SHORTCUT_CATEGORIES.workspace.id,
    release: () => {
      libraryCategoryUsers = Math.max(0, libraryCategoryUsers - 1);
      if (libraryCategoryUsers === 0) {
        ownedLibraryCategoryDisposer?.();
        ownedLibraryCategoryDisposer = null;
      }
    },
  };
}

/** Whether a home shortcut may claim the current keyboard event. */
function libraryShortcutAvailable(context: ShortcutContext): boolean {
  return context.atHome && !context.textEntry && context.surface === null;
}

/** Registers Q/E beside the other workspace commands; returns their disposer. */
export function registerLibraryShortcuts(handlers: LibraryShortcutHandlers): ShortcutDisposer {
  const category = acquireLibraryCategory();
  const disposePrevious = shortcutRegistry.registerShortcut({
    id: LIBRARY_SHORTCUT_IDS.previous,
    category: category.id,
    title: "shortcuts.library.previous",
    defaults: [{ key: "Q" }],
    scope: "app",
    // The editor uses Q for placing a Tap; the two never run together, and the
    // shortcut editor should not call the pair a mistake.
    shared: true,
    when: libraryShortcutAvailable,
    run: () => handlers.previous(),
  });
  const disposeNext = shortcutRegistry.registerShortcut({
    id: LIBRARY_SHORTCUT_IDS.next,
    category: category.id,
    title: "shortcuts.library.next",
    defaults: [{ key: "E" }],
    scope: "app",
    shared: true,
    when: libraryShortcutAvailable,
    run: () => handlers.next(),
  });
  return () => {
    disposePrevious();
    disposeNext();
    category.release();
  };
}

/** Registers five-second preview seeking beside the home-library commands. */
export function registerLibraryPreviewShortcuts(
  handlers: LibraryPreviewShortcutHandlers,
): ShortcutDisposer {
  const category = acquireLibraryCategory();
  const disposeBackward = shortcutRegistry.registerShortcut({
    id: LIBRARY_SHORTCUT_IDS.seekBackward,
    category: category.id,
    title: "shortcuts.library.seekBackward",
    defaults: [{ key: "ArrowLeft" }],
    scope: "app",
    shared: true,
    when: libraryShortcutAvailable,
    run: () => handlers.seekBackward(),
  });
  const disposeForward = shortcutRegistry.registerShortcut({
    id: LIBRARY_SHORTCUT_IDS.seekForward,
    category: category.id,
    title: "shortcuts.library.seekForward",
    defaults: [{ key: "ArrowRight" }],
    scope: "app",
    shared: true,
    when: libraryShortcutAvailable,
    run: () => handlers.seekForward(),
  });
  return () => {
    disposeBackward();
    disposeForward();
    category.release();
  };
}
