/**
 * Progressive page-body hydration for the settings window.
 *
 * The dialog opens on its shell and the active page. Every other page body
 * waits for one idle slice, so a large catalog cannot own the opening frame;
 * a page that has not been woken keeps a skeleton placeholder until then.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Page keys that currently have a mounted body plus the reset for a close. */
export interface SettingsPageHydration {
  readonly readyPages: ReadonlySet<string>;
  /** Drop every woken page after the dialog's exit transition. */
  reset(): void;
}

/**
 * Wake one page body per idle slice while the dialog is open.
 *
 * `pageKeys` keeps its identity while the catalog is unchanged, so registering
 * a new page restarts the queue and hydrates only the keys that are still
 * waiting. The active page and search results are rendered by the caller and
 * do not depend on this queue.
 */
export function useSettingsPageHydration({
  open,
  pageKeys,
}: {
  open: boolean;
  pageKeys: readonly string[];
}): SettingsPageHydration {
  const [readyPages, setReadyPages] = useState<ReadonlySet<string>>(() => new Set());
  const readyPagesRef = useRef<ReadonlySet<string>>(readyPages);

  /** Wake one page body; repeated requests for the same page are no-ops. */
  const markPageReady = useCallback((key: string) => {
    if (readyPagesRef.current.has(key)) {
      return;
    }
    const next = new Set(readyPagesRef.current);
    next.add(key);
    readyPagesRef.current = next;
    setReadyPages(next);
  }, []);

  /** Drop every woken page so the next open hydrates from scratch. */
  const reset = useCallback(() => {
    const empty = new Set<string>();
    readyPagesRef.current = empty;
    setReadyPages(empty);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    let handle: number | null = null;
    const queue = pageKeys.filter((key) => !readyPagesRef.current.has(key));
    let index = 0;
    /** Schedule the next slice once the browser has spare time. */
    function schedule() {
      if (cancelled || index >= queue.length) {
        return;
      }
      if (typeof window.requestIdleCallback === "function") {
        handle = window.requestIdleCallback(run, { timeout: 120 });
      } else {
        handle = window.setTimeout(run, 0);
      }
    }
    /** Mount one page body and queue the following one. */
    function run() {
      handle = null;
      if (cancelled) {
        return;
      }
      const key = queue[index++];
      if (key) {
        markPageReady(key);
      }
      schedule();
    }
    schedule();
    return () => {
      cancelled = true;
      if (handle === null) {
        return;
      }
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(handle);
      } else {
        window.clearTimeout(handle);
      }
    };
  }, [open, pageKeys, markPageReady]);

  return { readyPages, reset };
}

/**
 * The placeholder one page body shows while its idle hydration slice is pending.
 *
 * Mounting every page at once is what makes a large catalog stall the first
 * frame, so a page that has not been woken yet keeps the field grid's footprint
 * instead of leaving a blank gap. The scroller publishes `aria-busy`, so the
 * decoration itself stays out of the accessibility tree.
 */
export function SettingsPageSkeleton() {
  return (
    <div className="redux-settings-page-skeleton" aria-hidden="true">
      <div className="redux-settings-skeleton-rows">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="redux-settings-skeleton-row" key={index}>
            <span className="redux-settings-skeleton-line" />
            <span className="redux-settings-skeleton-control" />
          </div>
        ))}
      </div>
    </div>
  );
}
