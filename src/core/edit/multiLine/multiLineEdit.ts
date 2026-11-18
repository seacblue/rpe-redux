/**
 * Owns the multi-line editing switch and its shortcut declarations.
 *
 * The shared line list itself lives on the editor session; this module only
 * remembers it while multi-line editing is closed and keeps the J/K commands
 * next to the state they toggle.
 */
import type { EditorSession } from "../session/session.ts";
import type { EditorShortcutDefinition } from "../shortcuts/declarations.ts";
import { tokensFromLines } from "../state/lineSelectionTokens.ts";

/**
 * Leaves multi-line editing and remembers the shared line list.
 *
 * The workspace returns to the active line's ordinary timeline; the next toggle
 * restores the remembered list. Both the J shortcut and closing the multi-line
 * Inspector page take this path, so the timeline and the page agree.
 */
export function leaveMultiLineEditing(session: EditorSession): void {
  session.multiLineRestore = [...session.multiLineIndices];
  session.multiLineRestoreTokens = [...session.multiLineTokens];
  session.setMultiLineEnabled(false);
  session.setMultiLineSelection([session.lineIndex], {
    persist: false,
    tokens: tokensFromLines([session.lineIndex]),
  });
}

/** Keeps the field multi-line editing opens on: an exclusive visible field, else the field being edited. */
export function multiLineEntryMode(
  visible: { readonly notes: boolean; readonly events: boolean },
  focus: "notes" | "events",
): "notes" | "events" {
  if (visible.notes === visible.events) {
    return focus;
  }
  return visible.notes ? "notes" : "events";
}

// ------------------------------------------------------------------ shortcuts

/** The multi-line workspace is opened, closed and switched from these keys. */
export const multiLineShortcuts: readonly EditorShortcutDefinition[] = [
  {
    id: "workspace.multiLine.toggle",
    category: "editor.selection",
    title: "shortcuts.editor.toggleMultiLine",
    scope: "editor",
    // J and K are adjacent home-row keys, clear of the left-hand placement
    // keys. The sampling pane still owns the workspace while a sample is active.
    defaults: [{ key: "J" }],
    enabledFor: (context) => !context.samplingActive,
  },
  {
    id: "workspace.multiLine.switchMode",
    category: "editor.selection",
    title: "shortcuts.editor.switchMultiLineMode",
    scope: "editor",
    defaults: [{ key: "K" }],
    enabledFor: (context) => !context.samplingActive,
  },
];
