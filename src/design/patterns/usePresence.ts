/**
 * Keeps a closing surface mounted for one exit transition.
 *
 * Menus, sheets, and popovers are usually rendered from an `open` boolean. If
 * that boolean flips, React removes the element before CSS can animate it out.
 * This hook holds the element mounted for `duration` after `open` turns false,
 * and reports that it is closing so the surface can select its exit animation.
 */
import { useEffect, useState } from "react";

/** Whether the surface is mounted, and whether it is currently leaving. */
export interface Presence {
  mounted: boolean;
  closing: boolean;
}

/**
 * Track the presence of one boolean-driven surface.
 *
 * `duration` should match the surface's exit animation. Reopening during the
 * exit cancels the pending unmount immediately.
 */
export function usePresence(open: boolean, duration = 160): Presence {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return undefined;
    }
    if (!mounted) {
      return undefined;
    }
    setClosing(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [duration, mounted, open]);

  return { mounted, closing };
}
