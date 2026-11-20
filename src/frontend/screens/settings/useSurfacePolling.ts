/**
 * Visibility-gated polling for settings surfaces that list external packages.
 *
 * Settings pages stay mounted while the window is open, so mounting is not the
 * same as being on screen. Callers pass the page's `active` flag, and the
 * interval only runs while that surface is visible and the document is not
 * hidden.
 */
import { useEffect, useRef } from "react";

/** Folder poll interval while a package picker is on screen. */
export const PACKAGE_SCAN_INTERVAL_MS = 5000;

/** Runs `poll` once on activation, then on an interval while the surface is visible. */
export function useSurfacePolling(
  active: boolean,
  poll: () => void | Promise<void>,
  intervalMs = PACKAGE_SCAN_INTERVAL_MS,
): void {
  const pollRef = useRef(poll);
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);
  useEffect(() => {
    if (!active) {
      return;
    }
    let stopped = false;
    const run = () => {
      if (!stopped && !document.hidden) {
        void pollRef.current();
      }
    };
    run();
    const timer = window.setInterval(run, intervalMs);
    const onVisibilityChange = () => {
      if (!document.hidden) {
        run();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, intervalMs]);
}
