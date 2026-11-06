/** Tracks window focus and the user's background-volume preference for audio owners. */
import { values } from "../../core/state/values.ts";
import { clamp01 } from "../../core/utils/numbers.ts";

/** Sends the current foreground/background multiplier and returns its disposer. */
export function bindBackgroundVolume(apply: (multiplier: number) => void): () => void {
  const currentDocument = document;
  const currentWindow = window;
  const update = () => {
    const value = Number(
      values.byId.has("background-volume") ? values.byId.get<unknown>("background-volume") : 0.4,
    );
    // A range drag focuses the input without dispatching `window.focus`. Read
    // the live document state for every setting update so that slider changes
    // cannot apply the background multiplier to a foreground window.
    const foreground = !currentDocument.hidden && currentDocument.hasFocus();
    apply(foreground ? 1 : Number.isFinite(value) ? clamp01(value) : 0.4);
  };
  const focus = () => {
    update();
  };
  const blur = () => {
    update();
  };
  const visibility = () => {
    // Webviews can dispatch `visibilitychange` before the native focus state
    // catches up. Re-read the state once now and once on the next turn so
    // returning from another window always converges to the live answer.
    update();
    queueMicrotask(() => {
      update();
    });
  };
  currentWindow.addEventListener("focus", focus);
  currentWindow.addEventListener("blur", blur);
  currentDocument.addEventListener("visibilitychange", visibility);
  const unsubscribe = values.byId.has("background-volume")
    ? values.byId.subscribe("background-volume", update)
    : () => {};
  update();
  return () => {
    unsubscribe();
    currentWindow.removeEventListener("focus", focus);
    currentWindow.removeEventListener("blur", blur);
    currentDocument.removeEventListener("visibilitychange", visibility);
  };
}
