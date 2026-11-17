/**
 * Pure availability rules for shortcut scopes.
 *
 * The dispatcher supplies a context snapshot for each key press; this module
 * answers whether a scope may run and which scope wins when two commands share a
 * key. No DOM, z-index, or surface module reads these rules directly.
 */
import type { ShortcutContext, ShortcutScope } from "./types.ts";

/** Higher-priority scopes win when two registered commands share a binding. */
const SCOPE_PRIORITY: Record<ShortcutScope, number> = {
  emergency: 100,
  modal: 90,
  surface: 80,
  editor: 40,
  workspace: 30,
  app: 20,
  instrument: 10,
};

/** Every scope, in the order the overlap table enumerates them. */
const ALL_SCOPES: readonly ShortcutScope[] = [
  "emergency",
  "modal",
  "surface",
  "editor",
  "workspace",
  "app",
  "instrument",
];

/**
 * Which scopes can be available at the same moment.
 *
 * Built once from the same availability rule the dispatcher uses, over every
 * distinct context shape. Two bindings only collide when their scopes intersect
 * here: `editor` and `modal` never coexist, and neither do `editor` and
 * `surface`, because a drawn surface excludes the editor's own key table.
 * Parent and child scopes (`app` and `editor`, for example) do intersect, so a
 * shared key is still reported.
 */
const SCOPE_OVERLAPS: ReadonlyMap<ShortcutScope, ReadonlySet<ShortcutScope>> = buildScopeOverlaps();

/** The scopes a context can offer, enumerated from the live availability rule. */
function buildScopeOverlaps(): ReadonlyMap<ShortcutScope, ReadonlySet<ShortcutScope>> {
  const overlaps = new Map<ShortcutScope, Set<ShortcutScope>>(
    ALL_SCOPES.map((scope) => [scope, new Set<ShortcutScope>()]),
  );
  const modals = ["none", "normal", "urgent"] as const;
  const surfaces = [null, "menu", "dialog", "text"] as const;
  for (const capturing of [false, true]) {
    for (const modal of modals) {
      for (const documentOpen of [false, true]) {
        for (const atHome of [false, true]) {
          for (const surface of surfaces) {
            // The live reader never reports a text surface without text entry,
            // or text entry without a text surface; keep the sample truthful.
            const textEntry = surface === "text";
            const context: ShortcutContext = {
              atHome,
              documentOpen,
              modal,
              capturing,
              developerMode: false,
              textEntry,
              surface,
            };
            const available = ALL_SCOPES.filter((scope) => shortcutScopeAvailable(scope, context));
            for (const scope of available) {
              for (const other of available) {
                overlaps.get(scope)?.add(other);
              }
            }
          }
        }
      }
    }
  }
  return overlaps;
}

/** Whether two scopes can be available in the same context. */
export function shortcutScopesOverlap(left: ShortcutScope, right: ShortcutScope): boolean {
  return SCOPE_OVERLAPS.get(left)?.has(right) ?? false;
}

/**
 * Whether a shortcut in `scope` may run in `context`.
 *
 * The rules follow the product matrix: app commands work on every ordinary
 * surface, instrument commands also survive a normal modal, workspace commands
 * need an open document, and editor commands need the edit workspace. Capture and
 * urgent dialogs own the keyboard outright.
 */
export function shortcutScopeAvailable(scope: ShortcutScope, context: ShortcutContext): boolean {
  if (context.capturing) {
    return scope === "emergency";
  }
  if (context.modal === "urgent") {
    return scope === "emergency" || scope === "modal";
  }
  switch (scope) {
    case "emergency":
      return true;
    case "instrument":
      return true;
    case "app":
      return context.modal === "none";
    case "workspace":
      return (
        context.modal === "none" &&
        context.documentOpen &&
        !context.atHome &&
        !context.textEntry &&
        context.surface !== "menu" &&
        context.surface !== "dialog"
      );
    case "editor":
      return (
        context.modal === "none" &&
        context.documentOpen &&
        !context.atHome &&
        !context.textEntry &&
        context.surface !== "menu" &&
        context.surface !== "dialog"
      );
    case "surface":
      return context.modal === "none" && context.surface !== null;
    case "modal":
      return context.modal !== "none";
  }
}

/** The scope's dispatch precedence; larger values win a shared binding. */
export function shortcutScopePriority(scope: ShortcutScope): number {
  return SCOPE_PRIORITY[scope];
}
