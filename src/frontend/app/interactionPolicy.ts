/**
 * Document- and window-level input policy for the desktop shell: suppresses native
 * selection, dragging, browser shortcuts, and Tab traversal outside editable
 * fields, releases text-entry focus when a pointer lands elsewhere, and records
 * whether the last input was pointer, Tab navigation, or keyboard activation.
 */
import { isDialogSurface, isTextEntry } from "../platform/shortcuts/focus.ts";

const TEXT_ENTRY = "input, textarea, [contenteditable='true'], [role='textbox']";

let installed = false;

function canEditText(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(TEXT_ENTRY));
}

/** Whether the event target sits inside a dialog surface that owns its focus. */
function isInsideDialogSurface(target: EventTarget | null): boolean {
  return target instanceof Element && isDialogSurface(target);
}

/**
 * Own application-wide input policy for the lifetime of the desktop shell.
 *
 * Control-specific compatibility listeners remain in design/controls/enhance.ts
 * and are mounted by ControlHost; this module is the single frontend owner for
 * document/window policy.
 */
export function installInteractionPolicy(): () => void {
  if (installed) {
    return () => {};
  }
  installed = true;

  const preventSelection = (event: Event) => {
    if (!canEditText(event.target)) {
      event.preventDefault();
    }
  };
  const preventDocumentSelectAll = (event: KeyboardEvent) => {
    if (
      !canEditText(event.target) &&
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "a"
    ) {
      // Prevent the browser from selecting the page, but leave the event for
      // the shortcut dispatcher: Ctrl+A is also the editor's select-all command.
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    // Tab is the only modality that reveals a focus ring; activation keys
    // (Space/Enter/Escape) and pointer input leave the ring hidden.
    document.documentElement.dataset.inputMode = event.key === "Tab" ? "tab" : "keyboard";
    const key = event.key.toLowerCase();
    // Alt alone is the WebView's menu-access gesture. The app uses Alt-modified
    // shortcuts, so keep the bare modifier from grabbing focus and opening a
    // native menu before a real shortcut is pressed.
    if (event.key === "Alt" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
    }
    const modified = event.ctrlKey || event.metaKey;
    const browserShortcut =
      (modified &&
        ["r", "t", "w", "n", "o", "l", "j", "u", "p", "s", "f", "g", "h", "d", "e"].includes(
          key,
        )) ||
      (modified && event.shiftKey && ["i", "j", "c", "p", "t", "w"].includes(key)) ||
      (event.altKey &&
        ["arrowleft", "arrowright", "arrowup", "arrowdown", "f4", "home"].includes(key)) ||
      (modified && ["tab", "pageup", "pagedown"].includes(key)) ||
      ["f3", "f5", "f6", "f7", "f10", "f11"].includes(key);
    if (browserShortcut) {
      event.preventDefault();
    }
    // Modal settings and command surfaces rely on native focus traversal. The
    // editor canvas still keeps Tab out of the global shortcut path, but an
    // open dialog or an ARIA dialog/listbox owns its own keyboard navigation.
    if (event.key === "Tab" && !isInsideDialogSurface(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const onPointerDown = (event: PointerEvent) => {
    document.documentElement.dataset.inputMode = "pointer";
    // Canvas, timeline, and preview gestures cancel their pointer defaults to
    // own the drag, which also suppresses the browser's focus change. A text
    // field would then keep the caret - and every shortcut key - after the user
    // clicked away. Release it explicitly unless the press lands in the same
    // field (its text, a contenteditable descendant, or its own label).
    const active = document.activeElement;
    if (!isTextEntry(active as HTMLElement | null)) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Node) || target === active || active?.contains(target)) {
      return;
    }
    const label = target instanceof Element ? target.closest("label") : null;
    if (label instanceof HTMLLabelElement && label.control === active) {
      return;
    }
    (active as HTMLElement).blur();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === "Alt" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
    }
  };
  document.addEventListener("selectstart", preventSelection, true);
  document.addEventListener("dragstart", preventSelection, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("keydown", preventDocumentSelectAll, true);
  return () => {
    if (!installed) {
      return;
    }
    installed = false;
    document.removeEventListener("selectstart", preventSelection, true);
    document.removeEventListener("dragstart", preventSelection, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("keyup", onKeyUp, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("keydown", preventDocumentSelectAll, true);
    delete document.documentElement.dataset.inputMode;
  };
}
