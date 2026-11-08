/**
 * Window-drag decisions for the custom title bar.
 *
 * The title row is window chrome, not app content: a press may move the window,
 * but it must never become a click on the surface underneath. This module is
 * the pure decision layer — the movement threshold that separates a tap from a
 * drag, the single-pointer ownership rule, and the double-press test. The DOM
 * wiring in `useTitleBarWindowDrag.ts` only reports events and performs the
 * actions this layer asks for.
 */

/** Distance a press must travel before it becomes a window drag. */
export const WINDOW_DRAG_THRESHOLD_PX = 4;

/** Longest gap between two presses that still counts as a double press. */
export const WINDOW_DOUBLE_PRESS_MS = 500;

/** Largest movement between two presses that still counts as the same spot. */
export const WINDOW_DOUBLE_PRESS_SLOP_PX = 6;

/**
 * Title-row descendants that keep their own pointer behavior.
 *
 * These are the bar's buttons, its menus, and the popups they open. Every other
 * point in the row belongs to the window-drag gesture.
 */
export const WINDOW_DRAG_EXCLUDED_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='option']",
  "[role='slider']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='menu']",
  "[role='dialog']",
  "[data-window-drag-exclude]",
].join(", ");

/** One title-bar drag gesture: the press that opened it and its progress. */
export interface WindowDragGesture {
  /** The pointer that owns the gesture; null while the row is idle. */
  readonly pointerId: number | null;
  /** Client x of the press that opened the gesture. */
  readonly originX: number;
  /** Client y of the press that opened the gesture. */
  readonly originY: number;
  /** The gesture crossed the threshold, so the native window move owns it. */
  readonly dragging: boolean;
}

/** The idle gesture: no press is tracking the title row. */
export const IDLE_WINDOW_DRAG: WindowDragGesture = Object.freeze({
  pointerId: null,
  originX: 0,
  originY: 0,
  dragging: false,
});

/** One pointer fact that can change the gesture. */
export type WindowDragEvent =
  | { readonly type: "press"; readonly pointerId: number; readonly x: number; readonly y: number }
  | { readonly type: "move"; readonly pointerId: number; readonly x: number; readonly y: number }
  | { readonly type: "release"; readonly pointerId: number }
  | { readonly type: "cancel" };

/** The gesture after one event, plus the host work the event asks for. */
export interface WindowDragOutcome {
  /** State to carry into the next event. */
  readonly gesture: WindowDragGesture;
  /** This event crossed the threshold: start the native window move now. */
  readonly beginDrag: boolean;
  /** This event ended a move: the click that follows must be swallowed. */
  readonly endDrag: boolean;
}

/** An outcome that changes nothing and asks for no host work. */
function unchanged(gesture: WindowDragGesture): WindowDragOutcome {
  return { gesture, beginDrag: false, endDrag: false };
}

/**
 * Applies one pointer event to the title-bar gesture.
 *
 * A press always starts a fresh gesture. Movement from the owning pointer starts
 * the window move exactly once, when the distance first reaches
 * `WINDOW_DRAG_THRESHOLD_PX`; a release before that is an ordinary tap and asks
 * for no post-drag click suppression.
 */
export function reduceWindowDrag(
  gesture: WindowDragGesture,
  event: WindowDragEvent,
): WindowDragOutcome {
  switch (event.type) {
    case "press":
      return {
        gesture: {
          pointerId: event.pointerId,
          originX: event.x,
          originY: event.y,
          dragging: false,
        },
        beginDrag: false,
        endDrag: false,
      };
    case "move": {
      if (gesture.pointerId !== event.pointerId || gesture.dragging) {
        return unchanged(gesture);
      }
      const dx = event.x - gesture.originX;
      const dy = event.y - gesture.originY;
      if (dx * dx + dy * dy < WINDOW_DRAG_THRESHOLD_PX * WINDOW_DRAG_THRESHOLD_PX) {
        return unchanged(gesture);
      }
      return {
        gesture: { ...gesture, dragging: true },
        beginDrag: true,
        endDrag: false,
      };
    }
    case "release": {
      if (gesture.pointerId !== event.pointerId) {
        return unchanged(gesture);
      }
      return { gesture: IDLE_WINDOW_DRAG, beginDrag: false, endDrag: gesture.dragging };
    }
    case "cancel":
      return { gesture: IDLE_WINDOW_DRAG, beginDrag: false, endDrag: gesture.dragging };
  }
}

/**
 * Whether a new press at `(x, y)` repeats the previous tap at `(previous)`.
 *
 * The gap starts at the previous press, not its release, so a double press is
 * two presses within `WINDOW_DOUBLE_PRESS_MS` near the same spot. A caller that
 * starts a window move clears its previous-tap record, which keeps a drag
 * followed by a quick press from counting as a double press.
 */
export function isWindowDoublePress(
  previousAt: number,
  previousX: number,
  previousY: number,
  now: number,
  x: number,
  y: number,
): boolean {
  if (previousAt <= 0 || now - previousAt > WINDOW_DOUBLE_PRESS_MS) {
    return false;
  }
  const dx = x - previousX;
  const dy = y - previousY;
  return dx * dx + dy * dy <= WINDOW_DOUBLE_PRESS_SLOP_PX * WINDOW_DOUBLE_PRESS_SLOP_PX;
}
