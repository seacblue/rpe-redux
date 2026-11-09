/**
 * Extension emergency recovery.
 *
 * The stop chord is a hidden recovery gesture rather than a shortcut command:
 * it is checked before scopes and modals so it still works when a package has
 * made the ordinary input path unusable, but it never appears in the shortcut
 * editor and cannot be rebound.
 */
import { matches } from "../../core/shortcuts/keyMatching.ts";
import type { Shortcut } from "../../core/shortcuts/types.ts";
import { extensionRuntime } from "../../core/extensions/extensionRuntime.ts";

/** Hidden chord that disables every extension when ordinary input is broken. */
const EXTENSION_EMERGENCY_BINDING: Shortcut = {
  key: "F11",
  modifiers: ["CTRL", "ALT", "SHIFT"],
};

/**
 * Install the emergency recovery chord even when the editor is at home or a
 * modal is open. A broken package may be the reason the normal input path is
 * unusable.
 */
export function installExtensionRecovery(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!matches(event, EXTENSION_EMERGENCY_BINDING)) {
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
  };
}
