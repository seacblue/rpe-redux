/**
 * React hand-off from the static inline splash.
 *
 * The splash lives in `index.html` so it can paint before any stylesheet or
 * application chunk. `main.tsx` mounts this component beside the editor shell or
 * the detached performance HUD; its first layout effect switches the deferred
 * stylesheet on and removes the splash before the browser paints the React
 * surface, so neither path leaves a blank frame or a covered window.
 */
import { useLayoutEffect } from "react";
import { applyBootStyles, dismissBootSplash } from "./bootSplash.ts";

/** Applies the deferred stylesheet and removes the inline splash after commit. */
export function BootSplashHandoff() {
  useLayoutEffect(() => {
    applyBootStyles();
    dismissBootSplash();
  }, []);
  return null;
}
