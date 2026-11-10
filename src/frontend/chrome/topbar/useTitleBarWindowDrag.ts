/**
 * Installs the custom title row's window-drag gesture.
 *
 * The title row is window chrome, not app content: pressing it may move the
 * window, but it must never become a click on the surface underneath. A press
 * only starts the native move after the pointer crosses the drag threshold, so
 * the bar's own buttons keep their click behavior; a finished drag swallows the
 * click that would otherwise leak to the content below. The row keeps this
 * gesture while a modal scrim covers it, so pressing the dimmed band moves the
 * window instead of counting as an outside click that closes the dialog.
 */
import { useEffect, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktop } from "../../../core/platform/environment.ts";
import { controlWindow } from "./windowControls/windowControls.ts";
import {
  IDLE_WINDOW_DRAG,
  WINDOW_DRAG_EXCLUDED_SELECTOR,
  isWindowDoublePress,
  reduceWindowDrag,
  type WindowDragGesture,
} from "./windowDrag.ts";

/** How long a finished drag keeps swallowing the click it would leak. */
const CLICK_SUPPRESSION_MS = 400;

/** Safety cap for a native move that never reports its end. */
const CLICK_SUPPRESSION_CAP_MS = 10_000;

/** The dialog scrim that covers the title row but must not own its presses. */
const MODAL_SCRIM_SELECTOR = ".redux-modal-scrim";

/**
 * Installs the title row's pointer gesture over the window chrome.
 *
 * The gesture is registered once on the document so it also sees presses that
 * land on a modal scrim covering the row. Interactive descendants of the row
 * keep their own pointer behavior; double presses near the same spot toggle the
 * window's maximized state, matching the native title bar.
 */
export function useTitleBarWindowDrag(titleBar: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!isDesktop()) {
      return;
    }
    let gesture: WindowDragGesture = IDLE_WINDOW_DRAG;
    let suppressClick = false;
    let suppressionTimer = 0;
    let previousTapAt = 0;
    let previousTapX = 0;
    let previousTapY = 0;

    /** Drops a pending suppression, e.g. because a new press owns the pointer. */
    const disarmClickSuppression = (): void => {
      if (suppressionTimer !== 0) {
        window.clearTimeout(suppressionTimer);
        suppressionTimer = 0;
      }
      suppressClick = false;
    };

    /** Holds the suppression for the whole native move, which owns the pointer. */
    const holdClickSuppression = (): void => {
      if (suppressionTimer !== 0) {
        window.clearTimeout(suppressionTimer);
      }
      suppressClick = true;
      // A move command answers when the native loop ends; the cap keeps a
      // command that never answers from swallowing clicks for the session.
      suppressionTimer = window.setTimeout(disarmClickSuppression, CLICK_SUPPRESSION_CAP_MS);
    };

    /** Keeps the suppression armed for the click that trails the release. */
    const armClickSuppression = (): void => {
      disarmClickSuppression();
      suppressClick = true;
      suppressionTimer = window.setTimeout(disarmClickSuppression, CLICK_SUPPRESSION_MS);
    };

    /** Swallows the drag's trailing click before any app surface sees it. */
    const onCapturedClick = (event: MouseEvent): void => {
      if (!suppressClick) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      disarmClickSuppression();
    };

    /**
     * Starts the native window move after the press became a drag.
     *
     * On Windows the native move loop takes the pointer, so the page never sees
     * the release; the drag command settling is the signal that the move ended.
     */
    const beginWindowMove = (): void => {
      previousTapAt = 0;
      if (!isDesktop()) {
        return;
      }
      holdClickSuppression();
      void getCurrentWindow()
        .startDragging()
        .catch(() => {})
        .finally(() => {
          gesture = IDLE_WINDOW_DRAG;
          armClickSuppression();
        });
    };

    /** Captures a press on the title row or on a dialog scrim covering it. */
    const onCapturedPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) {
        return;
      }
      disarmClickSuppression();
      const bar = titleBar.current;
      if (!bar || gesture.pointerId !== null) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const rect = bar.getBoundingClientRect();
      if (rect.height <= 0 || event.clientY > rect.bottom) {
        return;
      }
      const inBar = bar.contains(target);
      const overScrim = !inBar && target.closest(MODAL_SCRIM_SELECTOR) !== null;
      if (!inBar && !overScrim) {
        return;
      }
      if (inBar && target.closest(WINDOW_DRAG_EXCLUDED_SELECTOR)) {
        return;
      }
      // The row is chrome: do not start a text selection or move app focus.
      event.preventDefault();
      if (overScrim) {
        // The scrim is above the dimmed row, but the window must stay movable
        // while a dialog is open: this press is window chrome, not an outside
        // click that cancels the dialog.
        event.stopPropagation();
      }
      const now = performance.now();
      if (
        isWindowDoublePress(
          previousTapAt,
          previousTapX,
          previousTapY,
          now,
          event.clientX,
          event.clientY,
        )
      ) {
        previousTapAt = 0;
        void controlWindow("maximize").catch(() => {});
        return;
      }
      previousTapAt = now;
      previousTapX = event.clientX;
      previousTapY = event.clientY;
      gesture = reduceWindowDrag(gesture, {
        type: "press",
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      }).gesture;
    };

    /** Starts the window move the first time the owning press crosses the threshold. */
    const onCapturedPointerMove = (event: PointerEvent): void => {
      if (gesture.pointerId === null) {
        return;
      }
      const outcome = reduceWindowDrag(gesture, {
        type: "move",
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      });
      gesture = outcome.gesture;
      if (outcome.beginDrag) {
        beginWindowMove();
      }
    };

    /** Ends the gesture and arms the trail-click suppression when it was a drag. */
    const onCapturedPointerUp = (event: PointerEvent): void => {
      if (gesture.pointerId === null) {
        return;
      }
      const outcome = reduceWindowDrag(gesture, {
        type: "release",
        pointerId: event.pointerId,
      });
      gesture = outcome.gesture;
      if (outcome.endDrag) {
        armClickSuppression();
      }
    };

    /** Ends the gesture when the pointer or the window focus is lost mid-press. */
    const onCapturedPointerCancel = (): void => {
      if (gesture.pointerId === null) {
        return;
      }
      const outcome = reduceWindowDrag(gesture, { type: "cancel" });
      gesture = outcome.gesture;
      if (outcome.endDrag) {
        armClickSuppression();
      }
    };

    document.addEventListener("pointerdown", onCapturedPointerDown, true);
    window.addEventListener("pointermove", onCapturedPointerMove, true);
    window.addEventListener("pointerup", onCapturedPointerUp, true);
    window.addEventListener("pointercancel", onCapturedPointerCancel, true);
    window.addEventListener("blur", onCapturedPointerCancel, true);
    window.addEventListener("click", onCapturedClick, true);
    return () => {
      document.removeEventListener("pointerdown", onCapturedPointerDown, true);
      window.removeEventListener("pointermove", onCapturedPointerMove, true);
      window.removeEventListener("pointerup", onCapturedPointerUp, true);
      window.removeEventListener("pointercancel", onCapturedPointerCancel, true);
      window.removeEventListener("blur", onCapturedPointerCancel, true);
      window.removeEventListener("click", onCapturedClick, true);
      disarmClickSuppression();
      gesture = IDLE_WINDOW_DRAG;
    };
  }, [titleBar]);
}
