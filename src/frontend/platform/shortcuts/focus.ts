/**
 * Focus classification helpers for the shortcut dispatcher.
 *
 * These checks use only a small surface of a DOM target, so every member is
 * optional. Real event targets, elements, and hand-written test doubles can all
 * be passed in.
 */
import { normalizeShortcutKey } from "../../../core/shortcuts/keys.ts";
import type { ShortcutEventLike } from "../../../core/shortcuts/types.ts";

export interface ShortcutTarget {
  isContentEditable?: boolean;
  type?: string;
  closest?: (selector: string) => ShortcutTarget | null;
  getAttribute?: (name: string) => string | null;
  blur?: () => void;
}

/** Whether the target accepts free text, including textareas and role=textbox. */
export function isTextEntry(target: ShortcutTarget | null | undefined): boolean {
  if (
    target?.isContentEditable ||
    target?.closest?.('textarea,[contenteditable="true"],[role="textbox"]')
  ) {
    return true;
  }
  const input = target?.closest?.("input");
  return Boolean(
    input &&
    !["button", "submit", "reset", "checkbox", "radio", "range", "file", "color"].includes(
      input.type ?? "",
    ),
  );
}

/** Whether the target is a text-entry field whose keystrokes are literal typing. */
export function isTypingText(target: ShortcutTarget | null | undefined): boolean {
  if (
    target?.isContentEditable ||
    target?.closest?.('textarea,[contenteditable="true"],[role="textbox"]')
  ) {
    return true;
  }
  const input = target?.closest?.("input");
  return Boolean(
    input && ["text", "search", "url", "email", "password", "tel"].includes(input.type ?? ""),
  );
}

/** Native dialogs and their ARIA equivalents own Tab traversal. */
export function isDialogSurface(target: ShortcutTarget | null | undefined): boolean {
  return Boolean(target?.closest?.('dialog[open],[role="dialog"],[role="listbox"]'));
}

/**
 * Whether focus sits on a surface that owns the keyboard outright.
 *
 * Dialogs and ARIA dialogs pause the workspace and editor scopes. Listboxes do
 * the same while they are pickers: an open list owns arrow and Space selection.
 * A listbox that marks itself as inline is part of its page instead, so a focused
 * row cannot swallow transport keys such as Space.
 */
export function isShortcutBlockingSurface(target: ShortcutTarget | null | undefined): boolean {
  if (target?.closest?.('dialog[open],[role="dialog"]')) {
    return true;
  }
  return Boolean(target?.closest?.('[role="listbox"]:not([data-inline-shortcut-surface])'));
}

/**
 * Whether a focused control declares this bare key as its own.
 *
 * A local owner draws and handles the key itself, so the global dispatcher must
 * let the event reach its React handler instead of running the workspace
 * command. Modified chords stay global: Ctrl+Space remains the editor's
 * preview-only command even while a media control has focus.
 */
export function claimsLocalShortcut(
  target: ShortcutTarget | null | undefined,
  event: ShortcutEventLike,
): boolean {
  if (!event.key || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return false;
  }
  const owner = target?.closest?.("[data-local-shortcut]");
  const declared = owner?.getAttribute?.("data-local-shortcut") ?? "";
  const key = normalizeShortcutKey(event.key);
  return declared.split(/\s+/).includes(key);
}

/** Drops focus from buttons and selects so a shortcut does not re-trigger them. */
export function releaseShortcutFocus(target: ShortcutTarget | null | undefined): void {
  if (!isTypingText(target) && target?.closest?.("input,select,button")) {
    target.blur?.();
  }
}

/**
 * Whether a focus event names the window itself.
 *
 * A capture-phase listener on the window also receives `blur` from focused
 * child controls. Held keyboard input must survive those element-level moves.
 */
export function isWindowBlur(target: EventTarget | null, windowTarget: EventTarget): boolean {
  return target === windowTarget;
}
