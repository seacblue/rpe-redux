/**
 * Registers the shortcuts declared beside toolbar actions.
 *
 * The action already owns its `run`; this bridge only turns that same callback
 * into a rebindable shortcut. A shortcut with an explicit `shortcutId` is
 * skipped because the editor owns the canonical declaration for it.
 */
import type { ShortcutDisposer } from "../../shortcuts/types.ts";
import { shortcutRegistry } from "../../shortcuts/registry.ts";
import { SHORTCUT_CATEGORIES } from "../../shortcuts/categories.ts";
import { actionAvailable, type ToolbarEntry } from "../registries/toolbar.ts";

const WORKSPACE_CATEGORY = SHORTCUT_CATEGORIES.workspace;

/**
 * Register rebindable shortcuts for toolbar actions that declare `shortcuts`
 * without a canonical `shortcutId`.
 *
 * Returns a disposer that removes the registrations and any category it created.
 */
export function registerToolbarShortcuts(entries: readonly ToolbarEntry[]): ShortcutDisposer {
  const disposers: ShortcutDisposer[] = [];
  const categoryDisposers: ShortcutDisposer[] = [];
  const categories = new Map<string, { id: string; dispose: ShortcutDisposer }>();
  for (const entry of entries) {
    if (entry.kind !== "action" || !entry.shortcuts?.length || entry.shortcutId) {
      continue;
    }
    const id = entry.id.trim();
    if (!id || shortcutRegistry.has(id)) {
      continue;
    }
    if (!entry.shortcutScope) {
      throw new Error(`Shortcut ${id} must declare a scope`);
    }
    const category = entry.shortcutCategory ?? WORKSPACE_CATEGORY;
    let registration = categories.get(category.id);
    if (!registration) {
      const alreadyRegistered = shortcutRegistry.hasCategory(category.id);
      registration = alreadyRegistered
        ? { id: category.id, dispose: () => {} }
        : shortcutRegistry.registerCategory(category);
      categories.set(category.id, registration);
      if (!alreadyRegistered) {
        categoryDisposers.push(registration.dispose);
      }
    }
    disposers.push(
      shortcutRegistry.registerShortcut({
        id,
        category: registration.id,
        // The key, not the text: the shortcut editor resolves it with `tRaw` so
        // it re-renders in the language in force (`ShortcutsSettings.tsx`).
        title: entry.label,
        defaults: [...(entry.shortcuts ?? [])],
        scope: entry.shortcutScope,
        when: entry.shortcutWhen,
        // The toolbar callback takes an optional menu target; the shortcut
        // dispatcher sends its own input, so it wraps rather than forwards.
        run: entry.run === undefined ? undefined : () => entry.run?.(),
        enabled: () => actionAvailable(entry),
      }),
    );
  }
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
    for (const dispose of categoryDisposers) {
      dispose();
    }
  };
}
