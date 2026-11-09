/**
 * Extension emergency recovery.
 *
 * The stop binding is registered like every other command, so it appears in the
 * shortcut editor, and it is checked before scopes and modals so it still works
 * when a package has made the ordinary input path unusable.
 */
import { SHORTCUT_CATEGORIES } from "../../core/shortcuts/categories.ts";
import { matches } from "../../core/shortcuts/keyMatching.ts";
import { shortcutRegistry } from "../../core/shortcuts/registry.ts";
import { extensionRuntime } from "../../core/extensions/extensionRuntime.ts";

/** Stable id for the emergency stop that disables every extension. */
export const EXTENSION_EMERGENCY_SHORTCUT_ID = "extensions.emergencyStop";

/**
 * Install the emergency stop even when the editor is at home or a modal is
 * open. A broken package may be the reason the normal input path is unusable.
 */
export function installExtensionRecovery(): () => void {
  let categoryDispose: (() => void) | null = null;
  if (!shortcutRegistry.hasCategory(SHORTCUT_CATEGORIES.tools.id)) {
    categoryDispose = shortcutRegistry.registerCategory(SHORTCUT_CATEGORIES.tools).dispose;
  }
  const shortcutDispose = shortcutRegistry.has(EXTENSION_EMERGENCY_SHORTCUT_ID)
    ? () => {}
    : shortcutRegistry.registerShortcut({
        id: EXTENSION_EMERGENCY_SHORTCUT_ID,
        category: SHORTCUT_CATEGORIES.tools.id,
        title: "shortcuts.app.extensionEmergencyStop",
        defaults: [{ key: "F11", modifiers: ["CTRL", "ALT", "SHIFT"] }],
        scope: "emergency",
      });
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      !shortcutRegistry
        .bindingsOf(EXTENSION_EMERGENCY_SHORTCUT_ID)
        .some((binding) => matches(event, binding))
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    extensionRuntime.disableAll();
    document.documentElement.dataset.extensionsDisabled = "emergency";
    window.dispatchEvent(new CustomEvent("redux:extensions-disabled", { detail: "emergency" }));
  };
  window.addEventListener("keydown", onKeyDown, true);
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    shortcutDispose();
    categoryDispose?.();
  };
}
