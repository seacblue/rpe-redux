/**
 * The toolbar's horizontal scrollbar.
 *
 * The two rows scroll as one surface, so one bar drives both. It is a real,
 * focusable scroll region whose track width is the rows' shared scroll range: a
 * drag, a wheel, a trackpad, and a keyboard all move it, and every movement is
 * forwarded to the rows, which stay in lockstep. The bar only renders while the
 * rows actually overflow, so a toolbar that fits has no dead track under it.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useTranslation } from "../../../i18n/react.ts";
import {
  calculateSharedScrollCompensation,
  readToolbarOverflowState,
  type ToolbarOverflowState,
} from "./toolbarOverflow.ts";

/** The narrowest the thumb may get, in pixels. */
const MIN_THUMB = 40;

/**
 * How much trailing space the probing pass adds to read a row's real content width.
 *
 * `scrollWidth` is never smaller than `clientWidth`, so a row that fits reports its
 * own viewport instead of its content. Padding the row past any plausible content
 * makes `scrollWidth` linear in the padding again, and subtracting the probe gives
 * the width the row occupies with no padding at all.
 */
const SCROLL_PROBE = 100_000;

/** Give every toolbar row the same scroll range, including a shorter one. */
function synchronizeScrollSpace(root: HTMLElement): HTMLElement[] {
  const lines = Array.from(root.querySelectorAll<HTMLElement>(".redux-toolbar-line"));
  // A hidden frame measures zero, and a zero viewport would make the probe look like
  // the row's own content. Skip it and let the resize observer measure once it has
  // a real width again.
  if (!lines.some((line) => line.clientWidth > 0)) {
    return lines;
  }
  const measurements = lines.map((line) => {
    line.style.setProperty("--toolbar-scroll-extra", `${SCROLL_PROBE}px`);
    return { clientWidth: line.clientWidth, contentWidth: line.scrollWidth - SCROLL_PROBE };
  });
  const compensation = calculateSharedScrollCompensation(measurements);
  lines.forEach((line, index) => {
    line.style.setProperty("--toolbar-scroll-extra", `${compensation[index]}px`);
  });
  return lines;
}

/** The widest scroll range any row has, which is the range the bar represents. */
function sharedScrollRange(lines: readonly HTMLElement[]): number {
  return Math.max(0, ...lines.map((line) => line.scrollWidth - line.clientWidth));
}

/**
 * The toolbar scrollbar.
 *
 * `toolbarRef` is the frame that owns the rows. The component measures them and
 * reports the overflow state upward, because the frame paints the edge fades from
 * that same answer.
 */
export function ToolbarScrollbar({
  toolbarRef,
  onStateChange,
}: {
  toolbarRef: RefObject<HTMLElement | null>;
  onStateChange?: (state: ToolbarOverflowState) => void;
}) {
  const { t } = useTranslation();
  const barRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLElement[]>([]);
  const syncing = useRef(false);

  /** Size the track from the rows' shared range, so the thumb means the same thing. */
  const syncTrack = useCallback(() => {
    const bar = barRef.current;
    const spacer = spacerRef.current;
    if (!bar || !spacer) {
      return;
    }
    // The bar hides itself while the rows fit, and a hidden box measures zero
    // wide. Sizing the track then would leave it exactly one viewport long, which
    // is a thumb filling the whole bar — no visible slider at all.
    const range = sharedScrollRange(linesRef.current);
    const width = bar.clientWidth + range;
    spacer.style.width = `${width}px`;
    bar.scrollLeft = linesRef.current[0]?.scrollLeft ?? 0;
  }, []);

  /** Re-measure the rows, size the bar's range, and publish the state. */
  const measure = useCallback(() => {
    const root = toolbarRef.current;
    if (!root) {
      return;
    }
    const lines = synchronizeScrollSpace(root);
    linesRef.current = lines;
    syncTrack();
    // The frame hides or shows the bar from the state published below, so the track
    // is sized once more after that decision, when the bar has a real width.
    requestAnimationFrame(syncTrack);
    onStateChange?.(readToolbarOverflowState(root));
  }, [onStateChange, toolbarRef, syncTrack]);

  useEffect(() => {
    const root = toolbarRef.current;
    if (!root) {
      return undefined;
    }
    const lines = Array.from(root.querySelectorAll<HTMLElement>(".redux-toolbar-line"));
    /**
     * Keep every row and the bar on one position.
     *
     * `source` is whichever element the gesture actually moved: the bar while it is
     * dragged, or the row a wheel or a trackpad scrolled. Every other participant
     * follows it, so a row is never left at a position the bar does not describe —
     * the placeholder that gives a short row the same range is what makes that
     * shared position meaningful.
     */
    const sharePosition = (source: HTMLElement) => {
      if (syncing.current) {
        return;
      }
      const bar = barRef.current;
      const position = source.scrollLeft;
      syncing.current = true;
      if (bar && Math.abs(bar.scrollLeft - position) > 1) {
        bar.scrollLeft = position;
      }
      for (const line of linesRef.current) {
        if (line !== source && Math.abs(line.scrollLeft - position) > 1) {
          line.scrollLeft = position;
        }
      }
      syncing.current = false;
      onStateChange?.(readToolbarOverflowState(root));
    };
    const followBar = () => {
      const bar = barRef.current;
      if (bar) {
        sharePosition(bar);
      }
    };
    const followRows = (event: Event) => {
      if (event.currentTarget instanceof HTMLElement) {
        sharePosition(event.currentTarget);
      }
    };
    const bar = barRef.current;
    bar?.addEventListener("scroll", followBar, { passive: true });
    lines.forEach((line) => line.addEventListener("scroll", followRows, { passive: true }));
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);
    lines.forEach((line) => resizeObserver.observe(line));
    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(root, { childList: true, subtree: true });
    measure();
    return () => {
      bar?.removeEventListener("scroll", followBar);
      lines.forEach((line) => line.removeEventListener("scroll", followRows));
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [measure, onStateChange, toolbarRef]);

  return (
    <div
      ref={barRef}
      className="redux-toolbar-scrollbar"
      role="scrollbar"
      tabIndex={-1}
      aria-orientation="horizontal"
      aria-label={t("chrome.toolbar.scrollbar")}
      aria-controls="toolbar-rows"
    >
      <div ref={spacerRef} className="redux-toolbar-scrollbar-spacer" aria-hidden="true" />
    </div>
  );
}

/** The narrowest thumb the shared skin allows, kept for the seam to read. */
export const TOOLBAR_MIN_THUMB = MIN_THUMB;
