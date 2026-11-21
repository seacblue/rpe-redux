/**
 * Visibility state behind the F4 developer detector panel.
 *
 * Capture is a persisted setting; panel visibility is a session value. Both
 * surfaces stay behind the same developer gate as the performance HUD.
 */
import { createValue } from "../../../core/state/values.ts";
import { developerMode } from "../../../core/platform/desktop/developer.ts";
import { developerReveal } from "../../../core/state/developerReveal.ts";

/** Whether the panel is open; not persisted. */
export const devDetectorVisible = createValue<boolean>({ initial: false });

/** Whether the host or the About-page gesture has opened developer tools. */
export function isDevDetectorAvailable(): boolean {
  return developerMode.get() || developerReveal.get();
}

/** Whether the panel should render right now. */
export function isDevDetectorVisible(): boolean {
  return isDevDetectorAvailable() && devDetectorVisible.get();
}

/** Subscribe to every flag that can change panel visibility. */
export function subscribeDevDetectorVisibility(listener: () => void): () => void {
  const disposers = [
    developerMode.subscribe(listener),
    developerReveal.subscribe(listener),
    devDetectorVisible.subscribe(listener),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

/** Flip the panel; a closed developer surface ignores the request. */
export function toggleDevDetectorPanel(): boolean {
  if (!isDevDetectorAvailable()) {
    return false;
  }
  const next = !devDetectorVisible.get();
  devDetectorVisible.set(next);
  return next;
}

/** Close the panel from its own header. */
export function closeDevDetectorPanel(): void {
  devDetectorVisible.set(false);
}
