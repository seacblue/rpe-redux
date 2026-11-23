/**
 * Horizontal overflow controls for the toolbar rows.
 *
 * The toolbar keeps every action at its authored size and exposes left/right
 * controls when the rows no longer fit. Both rows remain one synchronized
 * scrolling surface; the controls are only the gesture affordance.
 */
import { useCallback, useEffect, useState, type RefObject } from "react";
import { IconButton } from "../../../design/components/button/IconButton.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import {
  calculateSharedScrollCompensation,
  readToolbarOverflowState,
  type ToolbarOverflowState,
} from "./toolbarOverflow.ts";

/** The distance one chevron click moves the shared toolbar surface. */
const TOOLBAR_SCROLL_STEP = 180;

/** Gives every toolbar row the same maximum scroll range, including short rows. */
function synchronizeToolbarScrollSpace(root: HTMLElement): HTMLElement[] {
  const lines = Array.from(root.querySelectorAll<HTMLElement>(".redux-toolbar-line"));
  const measurements = lines.map((line) => {
    const previousExtra = Number.parseFloat(line.style.getPropertyValue("--toolbar-scroll-extra"));
    return {
      clientWidth: line.clientWidth,
      contentWidth: line.scrollWidth - (Number.isFinite(previousExtra) ? previousExtra : 0),
    };
  });
  const compensation = calculateSharedScrollCompensation(measurements);
  lines.forEach((line, index) => {
    line.style.setProperty("--toolbar-scroll-extra", `${compensation[index]}px`);
  });
  return lines;
}

/** Synchronizes all rows to one horizontal scroll position. */
function synchronizeToolbarScrollPosition(lines: readonly HTMLElement[], source: HTMLElement) {
  const target = Math.max(0, source.scrollLeft);
  lines.forEach((line) => {
    if (Math.abs(line.scrollLeft - target) > 1) {
      line.scrollLeft = target;
    }
  });
}

/** Moves every toolbar row by one consistent viewport step. */
function scrollToolbarRows(root: HTMLElement | null, offset: number): void {
  if (!root) {
    return;
  }
  const lines = synchronizeToolbarScrollSpace(root);
  const current = lines[0]?.scrollLeft ?? 0;
  const maxScroll = Math.max(0, ...lines.map((line) => line.scrollWidth - line.clientWidth));
  const target = Math.max(0, Math.min(maxScroll, current + offset));
  lines.forEach((line) => {
    line.scrollTo({ left: target, behavior: "smooth" });
  });
}

/** Renders the two edge chevrons and keeps their state in sync with the rows. */
export function ToolbarScrollControls({
  toolbarRef,
  onStateChange,
}: {
  toolbarRef: RefObject<HTMLElement | null>;
  onStateChange?: (state: ToolbarOverflowState) => void;
}) {
  const { t } = useTranslation();
  const [scrollState, setScrollState] = useState<ToolbarOverflowState>({
    isNarrow: false,
    canScrollStart: false,
    canScrollEnd: false,
  });

  const measure = useCallback(() => {
    const root = toolbarRef.current;
    if (root) {
      synchronizeToolbarScrollSpace(root);
      const nextState = readToolbarOverflowState(root);
      setScrollState((previous) =>
        previous.isNarrow === nextState.isNarrow &&
        previous.canScrollStart === nextState.canScrollStart &&
        previous.canScrollEnd === nextState.canScrollEnd
          ? previous
          : nextState,
      );
      onStateChange?.(nextState);
    }
  }, [onStateChange, toolbarRef]);

  useEffect(() => {
    const root = toolbarRef.current;
    if (!root) {
      return undefined;
    }
    const lines = Array.from(root.querySelectorAll<HTMLElement>(".redux-toolbar-line"));
    const onScroll = (event: Event) => {
      const source = event.currentTarget;
      if (source instanceof HTMLElement) {
        synchronizeToolbarScrollPosition(lines, source);
      }
      measure();
    };
    lines.forEach((line) => line.addEventListener("scroll", onScroll, { passive: true }));
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);
    lines.forEach((line) => resizeObserver.observe(line));
    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(root, { childList: true, subtree: true });
    measure();
    return () => {
      lines.forEach((line) => line.removeEventListener("scroll", onScroll));
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [measure, toolbarRef]);

  const { canScrollStart, canScrollEnd } = scrollState;
  return (
    <>
      <IconButton
        className={`redux-toolbar-scroll-affordance is-start${canScrollStart ? " is-visible" : ""}`}
        icon="chevronLeft"
        size={28}
        label={t("chrome.toolbar.scrollStart")}
        tooltip={false}
        disabled={!canScrollStart}
        tabIndex={canScrollStart ? 0 : -1}
        onClick={() => scrollToolbarRows(toolbarRef.current, -TOOLBAR_SCROLL_STEP)}
      />
      <IconButton
        className={`redux-toolbar-scroll-affordance is-end${canScrollEnd ? " is-visible" : ""}`}
        icon="chevronRight"
        size={28}
        label={t("chrome.toolbar.scrollEnd")}
        tooltip={false}
        disabled={!canScrollEnd}
        tabIndex={canScrollEnd ? 0 : -1}
        onClick={() => scrollToolbarRows(toolbarRef.current, TOOLBAR_SCROLL_STEP)}
      />
    </>
  );
}
